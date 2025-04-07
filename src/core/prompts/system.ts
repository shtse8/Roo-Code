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

		// Perform substitutions
		let finalPrompt = fileCustomSystemPrompt
		finalPrompt = finalPrompt.replace(/\{\{ROLE_DEFINITION\}\}/g, roleDefinition)
		finalPrompt = finalPrompt.replace(/\{\{SHARED_TOOL_USE_SECTION\}\}/g, sharedToolUseSection)
		finalPrompt = finalPrompt.replace(/\{\{TOOL_DESCRIPTIONS\}\}/g, toolDescriptions)
		finalPrompt = finalPrompt.replace(/\{\{TOOL_USE_GUIDELINES\}\}/g, toolUseGuidelines)
		finalPrompt = finalPrompt.replace(/\{\{MCP_SERVERS_SECTION\}\}/g, mcpServersSection)
		finalPrompt = finalPrompt.replace(/\{\{CAPABILITIES_SECTION\}\}/g, capabilitiesSection)
		finalPrompt = finalPrompt.replace(/\{\{MODES_SECTION\}\}/g, modesSection)
		finalPrompt = finalPrompt.replace(/\{\{RULES_SECTION\}\}/g, rulesComponents.fullSection)
		// Add granular rule placeholders
		finalPrompt = finalPrompt.replace(/\{\{RULES_BASE_DIR\}\}/g, rulesComponents.baseDir)
		finalPrompt = finalPrompt.replace(/\{\{RULES_RELATIVE_PATHS\}\}/g, rulesComponents.relativePaths)
		finalPrompt = finalPrompt.replace(/\{\{RULES_NO_CD\}\}/g, rulesComponents.noCd)
		finalPrompt = finalPrompt.replace(/\{\{RULES_NO_HOME_CHAR\}\}/g, rulesComponents.noHomeChar)
		finalPrompt = finalPrompt.replace(
			/\{\{RULES_EXECUTE_COMMAND_CONTEXT\}\}/g,
			rulesComponents.executeCommandContext,
		)
		finalPrompt = finalPrompt.replace(/\{\{RULES_SEARCH_FILES_USAGE\}\}/g, rulesComponents.searchFilesUsage)
		finalPrompt = finalPrompt.replace(/\{\{RULES_NEW_PROJECT_STRUCTURE\}\}/g, rulesComponents.newProjectStructure)
		finalPrompt = finalPrompt.replace(/\{\{RULES_EDITING_TOOLS_AVAILABLE\}\}/g, rulesComponents.availableTools)
		finalPrompt = finalPrompt.replace(
			/\{\{RULES_EDITING_INSERT_CONTENT_DETAIL\}\}/g,
			rulesComponents.insertContentDetail,
		)
		finalPrompt = finalPrompt.replace(
			/\{\{RULES_EDITING_SEARCH_REPLACE_DETAIL\}\}/g,
			rulesComponents.searchReplaceDetail,
		)
		finalPrompt = finalPrompt.replace(/\{\{RULES_EDITING_PREFER_OTHER_TOOLS\}\}/g, rulesComponents.preferOtherTools)
		finalPrompt = finalPrompt.replace(
			/\{\{RULES_EDITING_WRITE_TO_FILE_DETAIL\}\}/g,
			rulesComponents.writeToFileDetail,
		)
		finalPrompt = finalPrompt.replace(/\{\{RULES_MODE_RESTRICTIONS\}\}/g, rulesComponents.modeRestrictions)
		finalPrompt = finalPrompt.replace(/\{\{RULES_PROJECT_CONTEXT\}\}/g, rulesComponents.projectContext)
		finalPrompt = finalPrompt.replace(/\{\{RULES_CODE_CHANGE_CONTEXT\}\}/g, rulesComponents.codeChangeContext)
		finalPrompt = finalPrompt.replace(/\{\{RULES_MINIMIZE_QUESTIONS\}\}/g, rulesComponents.minimizeQuestions)
		finalPrompt = finalPrompt.replace(/\{\{RULES_ASK_FOLLOWUP_USAGE\}\}/g, rulesComponents.askFollowupUsage)
		finalPrompt = finalPrompt.replace(/\{\{RULES_EXECUTE_COMMAND_OUTPUT\}\}/g, rulesComponents.executeCommandOutput)
		finalPrompt = finalPrompt.replace(/\{\{RULES_USER_PROVIDED_CONTENT\}\}/g, rulesComponents.userProvidedContent)
		finalPrompt = finalPrompt.replace(/\{\{RULES_GOAL_ORIENTED\}\}/g, rulesComponents.goalOriented)
		finalPrompt = finalPrompt.replace(/\{\{RULES_BROWSER_ACTION_USAGE\}\}/g, rulesComponents.browserActionUsage)
		finalPrompt = finalPrompt.replace(
			/\{\{RULES_NO_CONVERSATIONAL_ENDINGS\}\}/g,
			rulesComponents.noConversationalEndings,
		)
		finalPrompt = finalPrompt.replace(
			/\{\{RULES_NO_CONVERSATIONAL_STARTERS\}\}/g,
			rulesComponents.noConversationalStarters,
		)
		finalPrompt = finalPrompt.replace(/\{\{RULES_IMAGE_USAGE\}\}/g, rulesComponents.imageUsage)
		finalPrompt = finalPrompt.replace(/\{\{RULES_ENV_DETAILS_USAGE\}\}/g, rulesComponents.envDetailsUsage)
		finalPrompt = finalPrompt.replace(/\{\{RULES_ACTIVE_TERMINALS\}\}/g, rulesComponents.activeTerminals)
		finalPrompt = finalPrompt.replace(/\{\{RULES_MCP_OPERATIONS\}\}/g, rulesComponents.mcpOperations)
		finalPrompt = finalPrompt.replace(/\{\{RULES_WAIT_FOR_CONFIRMATION\}\}/g, rulesComponents.waitForConfirmation)
		finalPrompt = finalPrompt.replace(/\{\{SYSTEM_INFO_SECTION\}\}/g, systemInfoComponents.fullSection)
		finalPrompt = finalPrompt.replace(/\{\{SYSTEM_INFO_OS\}\}/g, systemInfoComponents.os)
		finalPrompt = finalPrompt.replace(/\{\{SYSTEM_INFO_SHELL\}\}/g, systemInfoComponents.shell)
		finalPrompt = finalPrompt.replace(/\{\{SYSTEM_INFO_HOME_DIR\}\}/g, systemInfoComponents.homeDir)
		finalPrompt = finalPrompt.replace(/\{\{SYSTEM_INFO_CWD\}\}/g, systemInfoComponents.cwd)
		finalPrompt = finalPrompt.replace(
			/\{\{SYSTEM_INFO_ENV_DETAILS_EXPLANATION\}\}/g,
			systemInfoComponents.envDetailsExplanation,
		)
		finalPrompt = finalPrompt.replace(/\{\{OBJECTIVE_SECTION\}\}/g, objectiveSection)
		// Add custom instruction placeholders
		finalPrompt = finalPrompt.replace(/\{\{CUSTOM_INSTRUCTIONS_SECTION\}\}/g, customInstructions.fullSection)
		finalPrompt = finalPrompt.replace(
			/\{\{CUSTOM_INSTRUCTIONS_LANGUAGE_PREFERENCE\}\}/g,
			customInstructions.languagePreference,
		)
		finalPrompt = finalPrompt.replace(/\{\{CUSTOM_INSTRUCTIONS_GLOBAL\}\}/g, customInstructions.globalInstructions)
		finalPrompt = finalPrompt.replace(
			/\{\{CUSTOM_INSTRUCTIONS_MODE_SPECIFIC\}\}/g,
			customInstructions.modeSpecificInstructions,
		)
		finalPrompt = finalPrompt.replace(
			/\{\{CUSTOM_INSTRUCTIONS_RULES_MODE_SPECIFIC\}\}/g,
			customInstructions.rulesModeSpecific,
		)
		finalPrompt = finalPrompt.replace(/\{\{CUSTOM_INSTRUCTIONS_RULES_GENERIC\}\}/g, customInstructions.rulesGeneric)
		finalPrompt = finalPrompt.replace(
			/\{\{CUSTOM_INSTRUCTIONS_RULES_ROOIGNORE\}\}/g,
			customInstructions.rulesRooIgnore,
		)
		finalPrompt = finalPrompt.replace(/\{\{CUSTOM_INSTRUCTIONS_RULES_ALL\}\}/g, customInstructions.rulesAll)
		// TODO: Consider adding other placeholders like {{CWD}}, {{MODE_SLUG}}, {{LANGUAGE}} if useful

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
