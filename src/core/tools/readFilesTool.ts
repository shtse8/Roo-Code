import path from "path"
import { Cline } from "../Cline"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { ToolUse } from "../assistant-message" // Assuming ToolUse params will be updated
import { formatResponse } from "../prompts/responses"
import { t } from "../../i18n"
import { AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "./types"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { getReadablePath } from "../../utils/path"
import { countFileLines } from "../../integrations/misc/line-counter"
import { readLines } from "../../integrations/misc/read-lines"
import { extractTextFromFile, addLineNumbers } from "../../integrations/misc/extract-text"
import { parseSourceCodeDefinitionsForFile } from "../../services/tree-sitter"
import { isBinaryFile } from "isbinaryfile"

// Define a structure for individual file results or errors
interface FileResult {
	path: string
	content?: string
	error?: string
	isTruncated?: boolean
	totalLines?: number
	sourceCodeDef?: string
}

// New function for the batch read tool
export async function readFilesTool(
	cline: Cline,
	block: ToolUse, // Expecting block.params.paths to be string[]
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag, // Keep for consistency
) {
	// Expect 'paths' as an array of strings
	const relPathsInput: string[] | undefined = block.params.paths // Directly expect string[]
	const startLineStr: string | undefined = block.params.start_line
	const endLineStr: string | undefined = block.params.end_line

	// --- Parameter Validation ---
	if (!relPathsInput || !Array.isArray(relPathsInput) || relPathsInput.length === 0) {
		cline.consecutiveMistakeCount++
		pushToolResult(
			await cline.sayAndCreateMissingParamError(
				"read_files", // Use the new tool name
				"paths",
				"Expected a non-empty array of file paths.",
			),
		)
		return
	}

	// Filter out any non-string or empty paths just in case
	const relPaths = relPathsInput.filter((p) => typeof p === "string" && p.trim() !== "")
	if (relPaths.length === 0) {
		cline.consecutiveMistakeCount++
		await cline.say("error", "The 'paths' parameter array contains only invalid or empty paths.")
		pushToolResult(formatResponse.toolError("Invalid 'paths' parameter: No valid paths provided."))
		return
	}

	// --- Line Range Parsing (applies to all files in the batch) ---
	let isRangeRead = false
	let startLine: number | undefined = undefined
	let endLine: number | undefined = undefined

	if (startLineStr || endLineStr) {
		isRangeRead = true
	}
	if (startLineStr) {
		startLine = parseInt(startLineStr)
		if (isNaN(startLine)) {
			cline.consecutiveMistakeCount++
			await cline.say("error", `Failed to parse start_line: ${startLineStr}`)
			pushToolResult(formatResponse.toolError("Invalid start_line value"))
			return
		}
		startLine = Math.max(0, startLine - 1) // 0-based index
	}
	if (endLineStr) {
		endLine = parseInt(endLineStr)
		if (isNaN(endLine)) {
			cline.consecutiveMistakeCount++
			await cline.say("error", `Failed to parse end_line: ${endLineStr}`)
			pushToolResult(formatResponse.toolError("Invalid end_line value"))
			return
		}
		endLine = Math.max(0, endLine - 1) // 0-based index
	}
	if (startLine !== undefined && endLine !== undefined && startLine > endLine) {
		cline.consecutiveMistakeCount++
		await cline.say("error", `start_line (${startLine + 1}) cannot be greater than end_line (${endLine + 1}).`)
		pushToolResult(formatResponse.toolError("Invalid line range: start_line > end_line."))
		return
	}

	// --- Approval Logic ---
	const { maxReadFileLine = 500 } = (await cline.providerRef.deref()?.getState()) ?? {}
	let lineSnippet = ""
	if (startLine !== undefined && endLine !== undefined) {
		lineSnippet = t("tools:readFile.linesRange", { start: startLine + 1, end: endLine + 1 })
	} else if (startLine !== undefined) {
		lineSnippet = t("tools:readFile.linesFromToEnd", { start: startLine + 1 })
	} else if (endLine !== undefined) {
		lineSnippet = t("tools:readFile.linesFromStartTo", { end: endLine + 1 })
	} else if (maxReadFileLine === 0) {
		lineSnippet = t("tools:readFile.definitionsOnly")
	} else if (maxReadFileLine > 0) {
		lineSnippet = t("tools:readFile.maxLines", { max: maxReadFileLine })
	}

	const pathsForApproval = relPaths.map((relPath) => {
		const fullPath = path.resolve(cline.cwd, relPath)
		return {
			path: getReadablePath(cline.cwd, relPath),
			isOutsideWorkspace: isPathOutsideWorkspace(fullPath),
			accessAllowed: cline.rooIgnoreController?.validateAccess(relPath) ?? true,
		}
	})

	const disallowedPaths = pathsForApproval.filter((p) => !p.accessAllowed).map((p) => p.path)
	if (disallowedPaths.length > 0) {
		const errorMsg = formatResponse.rooIgnoreError(disallowedPaths.join(", "))
		await cline.say("rooignore_error", errorMsg)
		pushToolResult(formatResponse.toolError(errorMsg))
		return
	}

	// Use the new tool name in the approval message
	const approvalContent = JSON.stringify({
		tool: "readFiles", // New tool name for clarity in UI/logs
		paths: pathsForApproval.map((p) => ({ path: p.path, isOutsideWorkspace: p.isOutsideWorkspace })),
		reason: lineSnippet,
	})

	if (block.partial) {
		await cline.ask("tool", approvalContent, block.partial).catch(() => {})
		return
	} else {
		cline.consecutiveMistakeCount = 0
		const didApprove = await askApproval("tool", approvalContent)
		if (!didApprove) {
			return
		}

		// --- File Reading Logic (Iterate and Process) ---
		const results: FileResult[] = []
		for (const relPath of relPaths) {
			const absolutePath = path.resolve(cline.cwd, relPath)
			let fileContent: string | undefined = undefined
			let fileError: string | undefined = undefined
			let isFileTruncated = false
			let sourceCodeDef = ""
			let currentTotalLines = 0

			try {
				if (!(cline.rooIgnoreController?.validateAccess(relPath) ?? true)) {
					throw new Error(formatResponse.rooIgnoreError(relPath))
				}

				try {
					currentTotalLines = await countFileLines(absolutePath)
				} catch (countError) {
					console.warn(`Could not count lines for ${absolutePath}:`, countError)
				}

				const isBinary = await isBinaryFile(absolutePath).catch(() => false)

				if (isRangeRead) {
					const lines = await readLines(absolutePath, endLine, startLine)
					fileContent = addLineNumbers(lines, startLine !== undefined ? startLine + 1 : 1)
				} else if (!isBinary && maxReadFileLine >= 0 && currentTotalLines > maxReadFileLine) {
					isFileTruncated = true
					const [readContentResult, defResult] = await Promise.all([
						maxReadFileLine > 0 ? readLines(absolutePath, maxReadFileLine - 1, 0) : Promise.resolve(""),
						parseSourceCodeDefinitionsForFile(absolutePath, cline.rooIgnoreController),
					])
					fileContent = readContentResult.length > 0 ? addLineNumbers(readContentResult) : ""
					if (defResult) {
						sourceCodeDef = `\n\n${defResult}`
					}
				} else {
					fileContent = await extractTextFromFile(absolutePath)
				}

				results.push({
					path: relPath,
					content: fileContent,
					isTruncated: isFileTruncated,
					totalLines: currentTotalLines,
					sourceCodeDef: sourceCodeDef,
				})
			} catch (error: any) {
				console.error(`Error reading file ${absolutePath}:`, error)
				fileError = error.message || "Unknown error reading file"
				results.push({ path: relPath, error: fileError })
			}
		}

		// --- Format Final Result ---
		let finalXmlResult = "<files>\n" // Root tag for multiple files
		for (const result of results) {
			finalXmlResult += `  <file>\n    <path>${result.path}</path>\n`
			if (result.content !== undefined) {
				let contentBlock = result.content
				if (result.isTruncated) {
					contentBlock += `\n\n[Showing only ${maxReadFileLine} of ${result.totalLines} total lines. Use start_line and end_line if you need to read more]${result.sourceCodeDef}`
				}
				finalXmlResult += `    <content>\n${contentBlock}\n    </content>\n`
			} else if (result.error) {
				finalXmlResult += `    <error>${result.error}</error>\n`
			}
			finalXmlResult += `  </file>\n`
		}
		finalXmlResult += "</files>"

		pushToolResult(finalXmlResult)
	}
}
