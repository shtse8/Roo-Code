import * as path from "path"
import { Cline } from "../Cline"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { ToolUse } from "../assistant-message" // Assuming ToolUse params are updated
import { formatResponse } from "../prompts/responses"
import { listFiles } from "../../services/glob/list-files"
import { getReadablePath } from "../../utils/path"
import { AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "./types"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"

// Define structure for individual directory listing results or errors
interface ListResult {
	path: string
	content?: string // The formatted list string
	error?: string
	didHitLimit?: boolean
}

// New function for the batch list tool
export async function listDirectoriesTool(
	cline: Cline,
	block: ToolUse, // Expecting block.params.paths to be string[]
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag, // Keep for consistency
) {
	// Expect 'paths' as an array of strings
	const relDirPathsInput: string[] | undefined = block.params.paths // Use 'paths' param
	const recursiveRaw: string | undefined = block.params.recursive
	const recursive = recursiveRaw?.toLowerCase() === "true"

	// --- Parameter Validation ---
	if (!relDirPathsInput || !Array.isArray(relDirPathsInput) || relDirPathsInput.length === 0) {
		cline.consecutiveMistakeCount++
		pushToolResult(
			await cline.sayAndCreateMissingParamError(
				"list_directories", // Use the new tool name
				"paths",
				"Expected a non-empty array of directory paths.",
			),
		)
		return
	}

	const relDirPaths = relDirPathsInput.filter((p) => typeof p === "string" && p.trim() !== "")
	if (relDirPaths.length === 0) {
		cline.consecutiveMistakeCount++
		await cline.say("error", "The 'paths' parameter array contains only invalid or empty paths.")
		pushToolResult(formatResponse.toolError("Invalid 'paths' parameter: No valid paths provided."))
		return
	}

	// --- Approval Logic ---
	const pathsForApproval = relDirPaths.map((relDirPath) => {
		const fullPath = path.resolve(cline.cwd, relDirPath)
		return {
			path: getReadablePath(cline.cwd, relDirPath),
			isOutsideWorkspace: isPathOutsideWorkspace(fullPath),
			accessAllowed: cline.rooIgnoreController?.validateAccess(relDirPath) ?? true, // Assuming .rooignore applies to listing too
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
		tool: "listDirectories", // New tool name
		paths: pathsForApproval.map((p) => ({ path: p.path, isOutsideWorkspace: p.isOutsideWorkspace })),
		recursive: recursive,
	})

	if (block.partial) {
		// Partial doesn't make much sense here either
		await cline.ask("tool", approvalContent, block.partial).catch(() => {})
		return
	} else {
		cline.consecutiveMistakeCount = 0
		const didApprove = await askApproval("tool", approvalContent)
		if (!didApprove) {
			return
		}

		// --- Directory Listing Logic (Iterate and Process) ---
		const results: ListResult[] = []
		const { showRooIgnoredFiles = true } = (await cline.providerRef.deref()?.getState()) ?? {}

		for (const relDirPath of relDirPaths) {
			const absolutePath = path.resolve(cline.cwd, relDirPath)
			try {
				if (!(cline.rooIgnoreController?.validateAccess(relDirPath) ?? true)) {
					throw new Error(formatResponse.rooIgnoreError(relDirPath))
				}

				const [files, didHitLimit] = await listFiles(absolutePath, recursive, 200) // Keep limit for listing? Yes.
				const formattedList = formatResponse.formatFilesList(
					absolutePath,
					files,
					didHitLimit,
					cline.rooIgnoreController,
					showRooIgnoredFiles,
				)
				results.push({
					path: relDirPath,
					content: formattedList,
					didHitLimit: didHitLimit,
				})
			} catch (error: any) {
				console.error(`Error listing directory ${absolutePath}:`, error)
				const errorMsg = error.message || "Unknown error listing directory"
				await handleError(`listing directory ${relDirPath}`, error) // Handle error per directory
				results.push({ path: relDirPath, error: errorMsg })
			}
		}

		// --- Format Final Result ---
		let finalXmlResult = "<directories>\n" // Root tag
		for (const result of results) {
			finalXmlResult += `  <directory>\n    <path>${result.path}</path>\n`
			if (result.content !== undefined) {
				finalXmlResult += `    <content>\n${result.content}\n    </content>\n`
				if (result.didHitLimit) {
					finalXmlResult += `    <limit_hit>true</limit_hit>\n`
				}
			} else if (result.error) {
				finalXmlResult += `    <error>${result.error}</error>\n`
			}
			finalXmlResult += `  </directory>\n`
		}
		finalXmlResult += "</directories>"

		pushToolResult(finalXmlResult)
	}
}
