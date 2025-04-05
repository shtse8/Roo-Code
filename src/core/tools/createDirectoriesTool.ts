import * as vscode from "vscode"
import path from "path"
import { Cline } from "../Cline"
import { ToolUse } from "../assistant-message"
import { formatResponse } from "../prompts/responses"
import { AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "./types"
import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"

// Define structure for individual directory creation results or errors
interface CreateResult {
	path: string
	status: "success" | "error"
	error?: string
}

// New function for the batch create directories tool
export async function createDirectoriesTool(
	cline: Cline,
	block: ToolUse, // Expecting block.params.paths to be string[]
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag, // Keep for consistency
) {
	// Expect 'paths' as an array of strings
	const relDirPathsInput: string[] | undefined = block.params.paths

	// --- Parameter Validation ---
	if (!relDirPathsInput || !Array.isArray(relDirPathsInput) || relDirPathsInput.length === 0) {
		cline.consecutiveMistakeCount++
		pushToolResult(
			await cline.sayAndCreateMissingParamError(
				"create_directories", // Use the new tool name
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

	// --- .rooignore Check (Should we prevent creating ignored dirs?) ---
	// Let's assume for now we *allow* creating ignored dirs, but check for approval message context
	const pathsForApproval = relDirPaths.map((relDirPath) => {
		const fullPath = path.resolve(cline.cwd, relDirPath)
		return {
			path: getReadablePath(cline.cwd, relDirPath),
			isOutsideWorkspace: isPathOutsideWorkspace(fullPath),
			// accessAllowed: cline.rooIgnoreController?.validateAccess(relDirPath) ?? true // Maybe not needed for create?
		}
	})

	// --- Approval Logic ---
	const reason = `Will attempt to create ${relDirPaths.length} director(y/ies) and any necessary parent directories.`

	// Use the new tool name in the approval message
	const approvalContent = JSON.stringify({
		tool: "createDirectories", // New tool name
		paths: pathsForApproval.map((p) => ({ path: p.path, isOutsideWorkspace: p.isOutsideWorkspace })),
		reason: reason,
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

		// --- Directory Creation Logic (Iterate and Process) ---
		const results: CreateResult[] = []

		for (const relDirPath of relDirPaths) {
			const absolutePath = path.resolve(cline.cwd, relDirPath)
			try {
				// vscode.workspace.fs.createDirectory handles creating parent directories automatically
				await vscode.workspace.fs.createDirectory(vscode.Uri.file(absolutePath))
				results.push({ path: relDirPath, status: "success" })
				cline.didEditFile = true // Mark that a filesystem change occurred
			} catch (error: any) {
				const errorMsg = `Error creating directory ${relDirPath}: ${error.message || "Unknown error"}`
				console.error(errorMsg, error)
				await handleError(`creating directory ${relDirPath}`, error)
				results.push({ path: relDirPath, status: "error", error: error.message || "Unknown error" })
			}
		}

		// --- Format Final Result ---
		let finalXmlResult = "<creation_results>\n" // Root tag
		let successCount = 0
		let errorCount = 0
		for (const result of results) {
			finalXmlResult += `  <directory>\n    <path>${result.path}</path>\n    <status>${result.status}</status>\n`
			if (result.error) {
				finalXmlResult += `    <error>${result.error}</error>\n`
				errorCount++
			} else {
				successCount++
			}
			finalXmlResult += `  </directory>\n`
		}
		finalXmlResult += "</creation_results>"

		let summaryMessage = `Batch directory creation completed. ${successCount} director(y/ies) processed successfully.`
		if (errorCount > 0) {
			summaryMessage += ` ${errorCount} director(y/ies) failed to create.`
		}
		await cline.say("text", summaryMessage)
		pushToolResult(finalXmlResult)
	}
}
