import {
	Mode,
	modes,
	CustomModePrompts,
	PromptComponent,
	getRoleDefinition,
	defaultModeSlug,
	ModeConfig,
	getModeBySlug,
	getGroupName,
} from "../../shared/modes"
import { DiffStrategy } from "../diff/DiffStrategy"
import { McpHub } from "../../services/mcp/McpHub"
import { getToolDescriptionsForMode } from "./tools"
import * as vscode from "vscode"
import {
	getRulesSection,
	getSystemInfoSection,
	getObjectiveSection,
	getSharedToolUseSection,
	getMcpServersSection,
	getToolUseGuidelinesSection,
	getCapabilitiesSection,
	getModesSection,
	addCustomInstructions,
} from "./sections"
import { loadSystemPromptFile } from "./sections/custom-system-prompt"
import { formatLanguage } from "../../shared/language"

async function generatePrompt(
	context: vscode.ExtensionContext,
	cwd: string,
	supportsComputerUse: boolean,
	mode: Mode,
	mcpHub?: McpHub,
	diffStrategy?: DiffStrategy,
	browserViewportSize?: string,
	promptComponent?: PromptComponent,
	customModeConfigs?: ModeConfig[],
	globalCustomInstructions?: string,
	diffEnabled?: boolean,
	experiments?: Record<string, boolean>,
	enableMcpServerCreation?: boolean,
	language?: string,
	rooIgnoreInstructions?: string,
): Promise<string> {
	if (!context) {
		throw new Error("Extension context is required for generating system prompt")
	}

	// If diff is disabled, don't pass the diffStrategy
	const effectiveDiffStrategy = diffEnabled ? diffStrategy : undefined

	// Get the full mode config to ensure we have the role definition
	const modeConfig = getModeBySlug(mode, customModeConfigs) || modes.find((m) => m.slug === mode) || modes[0]
	const roleDefinition = promptComponent?.roleDefinition || modeConfig.roleDefinition

	const [modesSection, mcpServersSection] = await Promise.all([
		getModesSection(context),
		modeConfig.groups.some((groupEntry) => getGroupName(groupEntry) === "mcp")
			? getMcpServersSection(mcpHub, effectiveDiffStrategy, enableMcpServerCreation)
			: Promise.resolve(""),
	])

	const basePrompt = `${roleDefinition}

${getSharedToolUseSection()}

${getToolDescriptionsForMode(
	mode,
	cwd,
	supportsComputerUse,
	effectiveDiffStrategy,
	browserViewportSize,
	mcpHub,
	customModeConfigs,
	experiments,
)}

${getToolUseGuidelinesSection()}

${mcpServersSection}

${getCapabilitiesSection(cwd, supportsComputerUse, mcpHub, effectiveDiffStrategy)}

${modesSection}

${getRulesSection(cwd, supportsComputerUse, effectiveDiffStrategy, experiments).fullSection}

${getSystemInfoSection(cwd).fullSection}

${getObjectiveSection()}

${(await addCustomInstructions(promptComponent?.customInstructions || modeConfig.customInstructions || "", globalCustomInstructions || "", cwd, mode, { language: language ?? formatLanguage(vscode.env.language), rooIgnoreInstructions })).fullSection}`

	return basePrompt
}

export const SYSTEM_PROMPT = async (
	context: vscode.ExtensionContext,
	cwd: string,
	supportsComputerUse: boolean,
	mcpHub?: McpHub,
	diffStrategy?: DiffStrategy,
	browserViewportSize?: string,
	mode: Mode = defaultModeSlug,
	customModePrompts?: CustomModePrompts,
	customModes?: ModeConfig[],
	globalCustomInstructions?: string,
	diffEnabled?: boolean,
	experiments?: Record<string, boolean>,
	enableMcpServerCreation?: boolean,
	language?: string,
	rooIgnoreInstructions?: string,
): Promise<string> => {
	if (!context) {
		throw new Error("Extension context is required for generating system prompt")
	}

	const getPromptComponent = (value: unknown) => {
		if (typeof value === "object" && value !== null) {
			return value as PromptComponent
		}
		return undefined
	}

	// Try to load custom system prompt from file
	const fileCustomSystemPrompt = await loadSystemPromptFile(cwd, mode)

	// Check if it's a custom mode
	const promptComponent = getPromptComponent(customModePrompts?.[mode])

	// Get full mode config from custom modes or fall back to built-in modes
	const currentMode = getModeBySlug(mode, customModes) || modes.find((m) => m.slug === mode) || modes[0]

	// If diff is disabled, don't pass the diffStrategy
	const effectiveDiffStrategy = diffEnabled ? diffStrategy : undefined

	// If a file-based custom system prompt exists, use it after placeholder substitution
	if (fileCustomSystemPrompt) {
		// Generate all the sections needed for potential placeholders
		const roleDefinition = promptComponent?.roleDefinition || currentMode.roleDefinition
		const [modesSection, mcpServersSection] = await Promise.all([
			getModesSection(context),
			currentMode.groups.some((groupEntry) => getGroupName(groupEntry) === "mcp")
				? getMcpServersSection(mcpHub, effectiveDiffStrategy, enableMcpServerCreation)
				: Promise.resolve(""),
		])
		const sharedToolUseSection = getSharedToolUseSection()
		const toolDescriptions = getToolDescriptionsForMode(
			currentMode.slug,
			cwd,
			supportsComputerUse,
			effectiveDiffStrategy,
			browserViewportSize,
			mcpHub,
			customModes,
			experiments,
		)
		const toolUseGuidelines = getToolUseGuidelinesSection()
		const capabilitiesSection = getCapabilitiesSection(cwd, supportsComputerUse, mcpHub, effectiveDiffStrategy)
		const rulesComponents = getRulesSection(cwd, supportsComputerUse, effectiveDiffStrategy, experiments)
		const systemInfoComponents = getSystemInfoSection(cwd)
		const objectiveSection = getObjectiveSection()
		const customInstructions = await addCustomInstructions(
			promptComponent?.customInstructions || currentMode.customInstructions || "",
			globalCustomInstructions || "",
			cwd,
			currentMode.slug,
			{ language: language ?? formatLanguage(vscode.env.language), rooIgnoreInstructions },
		)

		// Define the mapping of placeholders to their values
		const placeholderMap: Record<string, string> = {
			"{{ROLE_DEFINITION}}": roleDefinition,
			"{{SHARED_TOOL_USE_SECTION}}": sharedToolUseSection,
			"{{TOOL_DESCRIPTIONS}}": toolDescriptions,
			"{{TOOL_USE_GUIDELINES}}": toolUseGuidelines,
			"{{MCP_SERVERS_SECTION}}": mcpServersSection,
			"{{CAPABILITIES_SECTION}}": capabilitiesSection,
			"{{MODES_SECTION}}": modesSection,
			"{{OBJECTIVE_SECTION}}": objectiveSection,
			// System Info
			"{{SYSTEM_INFO_SECTION}}": systemInfoComponents.fullSection,
			"{{SYSTEM_INFO_OS}}": systemInfoComponents.os,
			"{{SYSTEM_INFO_SHELL}}": systemInfoComponents.shell,
			"{{SYSTEM_INFO_HOME_DIR}}": systemInfoComponents.homeDir,
			"{{SYSTEM_INFO_CWD}}": systemInfoComponents.cwd,
			"{{SYSTEM_INFO_ENV_DETAILS_EXPLANATION}}": systemInfoComponents.envDetailsExplanation,
			// Rules
			"{{RULES_SECTION}}": rulesComponents.fullSection,
			"{{RULES_BASE_DIR}}": rulesComponents.baseDir,
			"{{RULES_RELATIVE_PATHS}}": rulesComponents.relativePaths,
			"{{RULES_NO_CD}}": rulesComponents.noCd,
			"{{RULES_NO_HOME_CHAR}}": rulesComponents.noHomeChar,
			"{{RULES_EXECUTE_COMMAND_CONTEXT}}": rulesComponents.executeCommandContext,
			"{{RULES_SEARCH_FILES_USAGE}}": rulesComponents.searchFilesUsage,
			"{{RULES_NEW_PROJECT_STRUCTURE}}": rulesComponents.newProjectStructure,
			"{{RULES_EDITING_TOOLS_AVAILABLE}}": rulesComponents.availableTools,
			"{{RULES_EDITING_INSERT_CONTENT_DETAIL}}": rulesComponents.insertContentDetail,
			"{{RULES_EDITING_SEARCH_REPLACE_DETAIL}}": rulesComponents.searchReplaceDetail,
			"{{RULES_EDITING_PREFER_OTHER_TOOLS}}": rulesComponents.preferOtherTools,
			"{{RULES_EDITING_WRITE_TO_FILE_DETAIL}}": rulesComponents.writeToFileDetail,
			"{{RULES_MODE_RESTRICTIONS}}": rulesComponents.modeRestrictions,
			"{{RULES_PROJECT_CONTEXT}}": rulesComponents.projectContext,
			"{{RULES_CODE_CHANGE_CONTEXT}}": rulesComponents.codeChangeContext,
			"{{RULES_MINIMIZE_QUESTIONS}}": rulesComponents.minimizeQuestions,
			"{{RULES_ASK_FOLLOWUP_USAGE}}": rulesComponents.askFollowupUsage,
			"{{RULES_EXECUTE_COMMAND_OUTPUT}}": rulesComponents.executeCommandOutput,
			"{{RULES_USER_PROVIDED_CONTENT}}": rulesComponents.userProvidedContent,
			"{{RULES_GOAL_ORIENTED}}": rulesComponents.goalOriented,
			"{{RULES_BROWSER_ACTION_USAGE}}": rulesComponents.browserActionUsage,
			"{{RULES_NO_CONVERSATIONAL_ENDINGS}}": rulesComponents.noConversationalEndings,
			"{{RULES_NO_CONVERSATIONAL_STARTERS}}": rulesComponents.noConversationalStarters,
			"{{RULES_IMAGE_USAGE}}": rulesComponents.imageUsage,
			"{{RULES_ENV_DETAILS_USAGE}}": rulesComponents.envDetailsUsage,
			"{{RULES_ACTIVE_TERMINALS}}": rulesComponents.activeTerminals,
			"{{RULES_MCP_OPERATIONS}}": rulesComponents.mcpOperations,
			"{{RULES_WAIT_FOR_CONFIRMATION}}": rulesComponents.waitForConfirmation,
			// Custom Instructions
			"{{CUSTOM_INSTRUCTIONS_SECTION}}": customInstructions.fullSection,
			"{{CUSTOM_INSTRUCTIONS_LANGUAGE_PREFERENCE}}": customInstructions.languagePreference,
			"{{CUSTOM_INSTRUCTIONS_GLOBAL}}": customInstructions.globalInstructions,
			"{{CUSTOM_INSTRUCTIONS_MODE_SPECIFIC}}": customInstructions.modeSpecificInstructions,
			"{{CUSTOM_INSTRUCTIONS_RULES_MODE_SPECIFIC}}": customInstructions.rulesModeSpecific,
			"{{CUSTOM_INSTRUCTIONS_RULES_GENERIC}}": customInstructions.rulesGeneric,
			"{{CUSTOM_INSTRUCTIONS_RULES_ROOIGNORE}}": customInstructions.rulesRooIgnore,
			"{{CUSTOM_INSTRUCTIONS_RULES_ALL}}": customInstructions.rulesAll,
			// Add requested placeholders
			"{{MODE_SLUG}}": currentMode.slug,
			"{{LANGUAGE}}": language ?? formatLanguage(vscode.env.language),
			// Removed "{{CWD}}": cwd, use "{{SYSTEM_INFO_CWD}}" instead
		}

		// Perform substitutions using reduce for better maintainability
		const finalPrompt = Object.entries(placeholderMap).reduce((prompt, [placeholder, value]) => {
			// Escape placeholder for regex usage
			const escapedPlaceholder = placeholder.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")
			return prompt.replace(new RegExp(escapedPlaceholder, "g"), value || "") // Replace with empty string if value is undefined/null
		}, fileCustomSystemPrompt)

		return finalPrompt
	}

	// If no file-based prompt, generate the default prompt
	return generatePrompt(
		context,
		cwd,
		supportsComputerUse,
		currentMode.slug,
		mcpHub,
		effectiveDiffStrategy,
		browserViewportSize,
		promptComponent,
		customModes,
		globalCustomInstructions,
		diffEnabled,
		experiments,
		enableMcpServerCreation,
		language,
		rooIgnoreInstructions,
	)
}
