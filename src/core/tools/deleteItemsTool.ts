import * as vscode from "vscode"
import path from "path"
import { Cline } from "../Cline"
import { ToolUse } from "../assistant-message"
import { formatResponse } from "../prompts/responses"
import { AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "./types"
import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"

// Define structure for individual deletion results or errors
interface DeleteResult {
	path: string
	status: "success" | "error"
	error?: string
}

// New function for the batch delete items tool
export async function deleteItemsTool(
	cline: Cline,
	block: ToolUse, // Expecting block.params.paths to be string[]
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag, // Keep for consistency
) {
	// Expect 'paths' as an array of strings
	const relPathsInput: string[] | undefined = block.params.paths

	// --- Parameter Validation ---
	if (!relPathsInput || !Array.isArray(relPathsInput) || relPathsInput.length === 0) {
		cline.consecutiveMistakeCount++
		pushToolResult(
			await cline.sayAndCreateMissingParamError(
				"delete_items", // Use the new tool name
				"paths",
				"Expected a non-empty array of file or directory paths to delete.",
			),
		)
		return
	}

	const relPaths = relPathsInput.filter((p) => typeof p === "string" && p.trim() !== "")
	if (relPaths.length === 0) {
		cline.consecutiveMistakeCount++
		await cline.say("error", "The 'paths' parameter array contains only invalid or empty paths.")
		pushToolResult(formatResponse.toolError("Invalid 'paths' parameter: No valid paths provided."))
		return
	}

	// --- .rooignore Check ---
	const pathsForApproval: {
		path: string
		readablePath: string
		isOutsideWorkspace: boolean
		accessAllowed: boolean
	}[] = []
	const disallowedPaths: string[] = []

	for (const relPath of relPaths) {
		const fullPath = path.resolve(cline.cwd, relPath)
		const accessAllowed = cline.rooIgnoreController?.validateAccess(relPath) ?? true
		pathsForApproval.push({
			path: relPath, // Keep original relPath for potential use later
			readablePath: getReadablePath(cline.cwd, relPath),
			isOutsideWorkspace: isPathOutsideWorkspace(fullPath),
			accessAllowed: accessAllowed,
		})
		if (!accessAllowed) {
			disallowedPaths.push(getReadablePath(cline.cwd, relPath)) // Use readable path for error message
		}
	}

	if (disallowedPaths.length > 0) {
		// It's generally safer *not* to delete ignored files unless explicitly intended.
		// We should prevent deletion of ignored paths.
		const errorMsg = formatResponse.rooIgnoreError(
			`Deletion prevented for ignored path(s): ${disallowedPaths.join(", ")}`,
		)
		await cline.say("rooignore_error", errorMsg)
		pushToolResult(formatResponse.toolError(errorMsg))
		return
	}

	// --- Approval Logic ---
	const reason = `Will attempt to PERMANENTLY delete ${relPaths.length} item(s) (files or directories). This action cannot be undone.`

	// Use the new tool name in the approval message
	const approvalContent = JSON.stringify({
		tool: "deleteItems", // New tool name
		paths: pathsForApproval.map((p) => ({ path: p.readablePath, isOutsideWorkspace: p.isOutsideWorkspace })),
		reason: reason, // Add a strong warning
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

		// --- Deletion Logic (Iterate and Process) ---
		const results: DeleteResult[] = []

		for (const relPath of relPaths) {
			const absolutePath = path.resolve(cline.cwd, relPath)
			const fileUri = vscode.Uri.file(absolutePath)
			try {
				// Use recursive: true to delete folders and their contents
				// Use useTrash: false for permanent deletion (be careful!)
				await vscode.workspace.fs.delete(fileUri, { recursive: true, useTrash: false })
				results.push({ path: relPath, status: "success" })
				cline.didEditFile = true // Mark that a filesystem change occurred
			} catch (error: any) {
				// Handle cases like file not found gracefully
				// Check error code directly instead of instanceof, which can be unreliable with mocks
				if (error?.code === "FileNotFound") {
					results.push({ path: relPath, status: "error", error: "File or directory not found." })
				} else {
					const errorMsg = `Error deleting ${relPath}: ${error.message || "Unknown error"}`
					console.error(errorMsg, error)
					await handleError(`deleting ${relPath}`, error)
					results.push({ path: relPath, status: "error", error: error.message || "Unknown error" })
				}
			}
		}

		// --- Format Final Result ---
		let finalXmlResult = "<deletion_results>\n" // Root tag
		let successCount = 0
		let errorCount = 0
		for (const result of results) {
			finalXmlResult += `  <item>\n    <path>${result.path}</path>\n    <status>${result.status}</status>\n`
			if (result.error) {
				finalXmlResult += `    <error>${result.error}</error>\n`
				errorCount++
			} else {
				successCount++
			}
			finalXmlResult += `  </item>\n`
		}
		finalXmlResult += "</deletion_results>"

		let summaryMessage = `Batch deletion completed. ${successCount} item(s) deleted successfully.`
		if (errorCount > 0) {
			summaryMessage += ` ${errorCount} item(s) failed to delete or were not found.`
		}
		await cline.say("text", summaryMessage)
		pushToolResult(finalXmlResult)
	}
}
