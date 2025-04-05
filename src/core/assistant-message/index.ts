export type AssistantMessageContent = TextContent | ToolUse

export { parseAssistantMessage } from "./parse-assistant-message"

export interface TextContent {
	type: "text"
	content: string
	partial: boolean
}

export const toolUseNames = [
	"execute_command",
	"read_file",
	"read_files", // Add new batch tool name
	"write_to_file",
	"write_files", // Add new batch tool name
	"apply_diff",
	"insert_content",
	"search_and_replace",
	"search_files",
	"list_files",
	"list_directories", // Add new batch tool name
	"list_code_definition_names",
	"create_directories", // Add new tool name
	"browser_action",
	"delete_items", // Add new tool name
	"use_mcp_tool",
	"access_mcp_resource",
	"ask_followup_question",
	"attempt_completion",
	"switch_mode",
	"new_task",
	"fetch_instructions",
] as const

// Converts array of tool call names into a union type ("execute_command" | "read_file" | ...)
export type ToolUseName = (typeof toolUseNames)[number]

export const toolParamNames = [
	"command",
	"path",
	"paths", // Ensure 'paths' parameter name exists
	"content",
	"items", // Ensure 'items' parameter name exists
	"line_count",
	"regex",
	"file_pattern",
	"recursive",
	"action",
	"url",
	"coordinate",
	"text",
	"server_name",
	"tool_name",
	"arguments",
	"uri",
	"question",
	"result",
	"diff",
	"start_line",
	"end_line",
	"mode_slug",
	"reason",
	"operations",
	"mode",
	"message",
	"cwd",
	"follow_up",
	"task",
] as const

export type ToolParamName = (typeof toolParamNames)[number]

export interface ToolUse {
	type: "tool_use"
	name: ToolUseName
	// params is a partial record, allowing only some or none of the possible parameters to be used
	// Allow params to hold various types (string, string[], etc.), rely on specific tool interfaces for stricter typing.
	params: Partial<Record<ToolParamName, any>>
	partial: boolean
}

export interface ExecuteCommandToolUse extends ToolUse {
	name: "execute_command"
	// Pick<Record<ToolParamName, string>, "command"> makes "command" required, but Partial<> makes it optional
	params: Partial<Pick<Record<ToolParamName, string>, "command" | "cwd">>
}

export interface ReadFileToolUse extends ToolUse {
	name: "read_file"
	params: Partial<Pick<Record<ToolParamName, string>, "path" | "start_line" | "end_line">>
}

// Define the interface for the new batch read tool
export interface ReadFilesToolUse extends ToolUse {
	name: "read_files"
	params: {
		paths: string[] // Required array of strings
		start_line?: string
		end_line?: string
	}
}

export interface FetchInstructionsToolUse extends ToolUse {
	name: "fetch_instructions"
	params: Partial<Pick<Record<ToolParamName, string>, "task">>
}

export interface WriteToFileToolUse extends ToolUse {
	name: "write_to_file"
	params: Partial<Pick<Record<ToolParamName, string>, "path" | "content" | "line_count">>
}

// Define WriteItem structure again or import if shared
interface WriteItem {
	path: string
	content: string
}
// Define the interface for the new batch write tool
export interface WriteFilesToolUse extends ToolUse {
	name: "write_files"
	params: {
		items: WriteItem[] // Required array of {path, content}
	}
}

// Define the interface for the new batch delete items tool
export interface DeleteItemsToolUse extends ToolUse {
	name: "delete_items"
	params: {
		paths: string[] // Required array of strings
	}
}

// Define the interface for the new batch create directories tool
export interface CreateDirectoriesToolUse extends ToolUse {
	name: "create_directories"
	params: {
		paths: string[] // Required array of strings
	}
}

export interface InsertCodeBlockToolUse extends ToolUse {
	name: "insert_content"
	params: Partial<Pick<Record<ToolParamName, string>, "path" | "operations">>
}

export interface SearchFilesToolUse extends ToolUse {
	name: "search_files"
	params: Partial<Pick<Record<ToolParamName, string>, "path" | "regex" | "file_pattern">>
}

export interface ListFilesToolUse extends ToolUse {
	name: "list_files"
	params: Partial<Pick<Record<ToolParamName, string>, "path" | "recursive">>
}

// Define the interface for the new batch list tool
export interface ListDirectoriesToolUse extends ToolUse {
	name: "list_directories"
	params: {
		paths: string[] // Required array of strings
		recursive?: string // Optional boolean as string
	}
}

export interface ListCodeDefinitionNamesToolUse extends ToolUse {
	name: "list_code_definition_names"
	params: Partial<Pick<Record<ToolParamName, string>, "path">>
}

export interface BrowserActionToolUse extends ToolUse {
	name: "browser_action"
	params: Partial<Pick<Record<ToolParamName, string>, "action" | "url" | "coordinate" | "text">>
}

export interface UseMcpToolToolUse extends ToolUse {
	name: "use_mcp_tool"
	params: Partial<Pick<Record<ToolParamName, string>, "server_name" | "tool_name" | "arguments">>
}

export interface AccessMcpResourceToolUse extends ToolUse {
	name: "access_mcp_resource"
	params: Partial<Pick<Record<ToolParamName, string>, "server_name" | "uri">>
}

export interface AskFollowupQuestionToolUse extends ToolUse {
	name: "ask_followup_question"
	params: Partial<Pick<Record<ToolParamName, string>, "question" | "follow_up">>
}

export interface AttemptCompletionToolUse extends ToolUse {
	name: "attempt_completion"
	params: Partial<Pick<Record<ToolParamName, string>, "result" | "command">>
}

export interface SwitchModeToolUse extends ToolUse {
	name: "switch_mode"
	params: Partial<Pick<Record<ToolParamName, string>, "mode_slug" | "reason">>
}

export interface NewTaskToolUse extends ToolUse {
	name: "new_task"
	params: Partial<Pick<Record<ToolParamName, string>, "mode" | "message">>
}
