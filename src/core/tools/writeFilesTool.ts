import * as vscode from "vscode"
import path from "path"
import { Cline } from "../Cline"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { ToolUse } from "../assistant-message" // Assuming ToolUse params are updated
import { formatResponse } from "../prompts/responses"
import { AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "./types"
import { fileExistsAtPath } from "../../utils/fs"
import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"

// Define the structure for batch write items (can be shared or redefined)
interface WriteItem {
	path: string
	content: string
}

// New function for the batch write tool
export async function writeFilesTool(
	cline: Cline,
	block: ToolUse, // Expecting block.params.items to be WriteItem[]
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag, // Keep for consistency
) {
	// Expect 'items' as an array of {path, content} objects
	const itemsInput: WriteItem[] | undefined = block.params.items

	// --- Parameter Validation ---
	if (!itemsInput || !Array.isArray(itemsInput) || itemsInput.length === 0) {
		cline.consecutiveMistakeCount++
		pushToolResult(
			await cline.sayAndCreateMissingParamError(
				"write_files", // Use the new tool name
				"items",
				"Expected a non-empty array of {path, content} objects.",
			),
		)
		return
	}

	const validItems: WriteItem[] = []
	const validationErrors: string[] = []
	for (let i = 0; i < itemsInput.length; i++) {
		const item = itemsInput[i]
		if (!item || typeof item !== "object") {
			validationErrors.push(`Item at index ${i} is not a valid object.`)
			continue
		}
		if (typeof item.path !== "string" || item.path.trim() === "") {
			validationErrors.push(`Item at index ${i} is missing a valid 'path'.`)
		}
		if (typeof item.content !== "string") {
			validationErrors.push(`Item at index ${i} is missing 'content'.`)
		}
		// Only add if basic validation passes for this item and path is valid
		if (validationErrors.length === 0 && typeof item.path === "string" && item.path.trim() !== "") {
			validItems.push({ path: item.path.trim(), content: item.content ?? "" }) // Ensure content is string
		} else if (typeof item.path !== "string" || item.path.trim() === "") {
			if (typeof item.content !== "string") {
				break // Stop if both path and content are invalid
			}
		}
	}

	if (
		validationErrors.length > 0 &&
		validationErrors.some((err) => err.includes("missing a valid 'path'") && err.includes("missing 'content'"))
	) {
		cline.consecutiveMistakeCount++
		const errorMsg = `Invalid 'items' parameter: ${validationErrors.join("; ")}`
		await cline.say("error", errorMsg)
		pushToolResult(formatResponse.toolError(errorMsg))
		return
	}
	const itemsToProcess = validItems.filter(
		(item) =>
			!validationErrors.some(
				(err) =>
					err.includes(
						`Item at index ${itemsInput.findIndex((inputItem) => inputItem.path === item.path)}`,
					) && err.includes("missing a valid 'path'"),
			),
	)
	if (itemsToProcess.length === 0 && itemsInput.length > 0) {
		cline.consecutiveMistakeCount++
		const errorMsg = `Invalid 'items' parameter: No valid items found. Errors: ${validationErrors.join("; ")}`
		await cline.say("error", errorMsg)
		pushToolResult(formatResponse.toolError(errorMsg))
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
	for (const item of itemsToProcess) {
		const relPath = item.path
		const fullPath = path.resolve(cline.cwd, relPath)
		const accessAllowed = cline.rooIgnoreController?.validateAccess(relPath) ?? true
		pathsForApproval.push({
			path: relPath,
			readablePath: getReadablePath(cline.cwd, relPath),
			isOutsideWorkspace: isPathOutsideWorkspace(fullPath),
			accessAllowed: accessAllowed,
		})
		if (!accessAllowed) {
			disallowedPaths.push(relPath)
		}
	}
	if (disallowedPaths.length > 0) {
		const errorMsg = formatResponse.rooIgnoreError(disallowedPaths.join(", "))
		await cline.say("rooignore_error", errorMsg)
		pushToolResult(formatResponse.toolError(errorMsg))
		return
	}

	// --- Approval Logic ---
	const fileStatuses = await Promise.all(
		itemsToProcess.map(async (item) => {
			const absolutePath = path.resolve(cline.cwd, item.path)
			const exists = await fileExistsAtPath(absolutePath)
			return { path: item.path, exists }
		}),
	)
	const newFiles = fileStatuses.filter((s) => !s.exists).map((s) => s.path)
	const existingFiles = fileStatuses.filter((s) => s.exists).map((s) => s.path)
	let reason = `Will create ${newFiles.length} new file(s)`
	if (existingFiles.length > 0) {
		reason += ` and overwrite ${existingFiles.length} existing file(s)`
	}
	reason += "."

	// Use the new tool name in the approval message
	const approvalContent = JSON.stringify({
		tool: "writeFiles", // New tool name
		paths: pathsForApproval.map((p) => ({
			path: p.readablePath,
			isOutsideWorkspace: p.isOutsideWorkspace,
			status: fileStatuses.find((s) => s.path === p.path)?.exists ? "overwrite" : "create",
		})),
		reason: reason,
	})

	if (block.partial) {
		// Partial doesn't make sense for this simplified batch write
		await cline.ask("tool", approvalContent, block.partial).catch(() => {})
		return
	} else {
		cline.consecutiveMistakeCount = 0
		const didApprove = await askApproval("tool", approvalContent)
		if (!didApprove) {
			return
		}

		// --- File Writing Logic ---
		const results: { path: string; status: "success" | "error"; error?: string }[] = []
		const encoder = new TextEncoder()

		for (const item of itemsToProcess) {
			const absolutePath = path.resolve(cline.cwd, item.path)
			try {
				const dir = path.dirname(absolutePath)
				if (dir !== absolutePath && dir !== cline.cwd && dir !== ".") {
					await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir))
				}
				const contentUint8Array = encoder.encode(item.content)
				await vscode.workspace.fs.writeFile(vscode.Uri.file(absolutePath), contentUint8Array)
				results.push({ path: item.path, status: "success" })
				cline.didEditFile = true
			} catch (error: any) {
				const errorMsg = `Error writing file ${item.path}: ${error.message || "Unknown error"}`
				console.error(errorMsg, error)
				await handleError(`writing file ${item.path}`, error)
				results.push({ path: item.path, status: "error", error: error.message || "Unknown error" })
			}
		}

		// --- Format Final Result ---
		let finalXmlResult = "<write_results>\n" // Root tag
		let successCount = 0
		let errorCount = 0
		for (const result of results) {
			finalXmlResult += `  <file>\n    <path>${result.path}</path>\n    <status>${result.status}</status>\n`
			if (result.error) {
				finalXmlResult += `    <error>${result.error}</error>\n`
				errorCount++
			} else {
				successCount++
			}
			finalXmlResult += `  </file>\n`
		}
		finalXmlResult += "</write_results>"

		let summaryMessage = `Batch write operation completed. ${successCount} file(s) written successfully.`
		if (errorCount > 0) {
			summaryMessage += ` ${errorCount} file(s) failed to write.`
		}
		await cline.say("text", summaryMessage) // Use standard text type
		pushToolResult(finalXmlResult)
		return
	}
}
