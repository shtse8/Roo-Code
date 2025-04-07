import * as vscode from "vscode"

import { SYSTEM_PROMPT } from "../system"
import { McpHub } from "../../../services/mcp/McpHub"
import { ClineProvider } from "../../../core/webview/ClineProvider"
import { defaultModeSlug, modes, Mode, ModeConfig } from "../../../shared/modes"
import "../../../utils/path" // Import path utils to get access to toPosix string extension.
import { addCustomInstructions } from "../sections/custom-instructions"
import { EXPERIMENT_IDS } from "../../../shared/experiments"
import { MultiSearchReplaceDiffStrategy } from "../../diff/strategies/multi-search-replace"

// Mock the sections
jest.mock("../sections/modes", () => ({
	getModesSection: jest.fn().mockImplementation(async () => `====\n\nMODES\n\n- Test modes section`),
}))

// Mock the custom instructions
jest.mock("../sections/custom-instructions", () => {
	const addCustomInstructions = jest.fn()
	return {
		addCustomInstructions,
		__setMockImplementation: (impl: any) => {
			addCustomInstructions.mockImplementation(impl)
		},
	}
})

// Mock loadSystemPromptFile
jest.mock("../sections/custom-system-prompt", () => ({
	loadSystemPromptFile: jest.fn().mockResolvedValue(null), // Default to null (no file found)
}))

// Set up default mock implementation
import { CustomInstructionsComponents } from "../sections/custom-instructions" // Import the interface

const { __setMockImplementation } = jest.requireMock("../sections/custom-instructions")
__setMockImplementation(
	async (
		modeCustomInstructions: string,
		globalCustomInstructions: string,
		cwd: string,
		mode: string,
		options?: { language?: string; rooIgnoreInstructions?: string },
	): Promise<CustomInstructionsComponents> => {
		const sections: string[] = []
		const rules: string[] = []

		// Language Preference
		const languagePreference = options?.language
			? `Language Preference:\nYou should always speak and think in the "${options.language}" language.`
			: ""
		if (languagePreference) sections.push(languagePreference)

		// Global Instructions
		const globalInstructions = globalCustomInstructions?.trim()
			? `Global Instructions:\n${globalCustomInstructions.trim()}`
			: ""
		if (globalInstructions) sections.push(globalInstructions)

		// Mode-Specific Instructions
		const modeSpecificInstructions = modeCustomInstructions?.trim()
			? `Mode-specific Instructions:\n${modeCustomInstructions}`
			: ""
		if (modeSpecificInstructions) sections.push(modeSpecificInstructions)

		// Mode-Specific Rules
		const rulesModeSpecific = mode ? `# Rules from .clinerules-${mode}:\nMock mode-specific rules` : ""
		if (rulesModeSpecific) rules.push(rulesModeSpecific)

		// RooIgnore Rules
		const rulesRooIgnore = options?.rooIgnoreInstructions || ""
		if (rulesRooIgnore) rules.push(rulesRooIgnore)

		// Generic Rules
		const rulesGeneric = `# Rules from .clinerules:\nMock generic rules` // Simplified for mock
		rules.push(rulesGeneric)

		// Combined Rules Section
		const rulesAll = rules.length > 0 ? `Rules:\n\n${rules.join("\n\n")}` : ""
		if (rulesAll) sections.push(rulesAll)

		// Full Section
		const joinedSections = sections.join("\n\n")
		const fullSection = joinedSections
			? `\n====\n\nUSER'S CUSTOM INSTRUCTIONS\n\nThe following additional instructions are provided by the user, and should be followed to the best of your ability without interfering with the TOOL USE guidelines.\n\n${joinedSections}`
			: ""

		return {
			languagePreference,
			globalInstructions,
			modeSpecificInstructions,
			rulesModeSpecific,
			rulesGeneric,
			rulesRooIgnore,
			rulesAll,
			fullSection,
		}
	},
)

// Mock environment-specific values for consistent tests
jest.mock("os", () => ({
	...jest.requireActual("os"),
	homedir: () => "/home/user",
}))

jest.mock("default-shell", () => "/bin/zsh")

jest.mock("os-name", () => () => "Linux")

// Mock vscode language
jest.mock("vscode", () => ({
	env: {
		language: "en",
	},
}))

jest.mock("../../../utils/shell", () => ({
	getShell: () => "/bin/zsh",
}))

// Create a mock ExtensionContext
const mockContext = {
	extensionPath: "/mock/extension/path",
	globalStoragePath: "/mock/storage/path",
	storagePath: "/mock/storage/path",
	logPath: "/mock/log/path",
	subscriptions: [],
	workspaceState: {
		get: () => undefined,
		update: () => Promise.resolve(),
	},
	globalState: {
		get: () => undefined,
		update: () => Promise.resolve(),
		setKeysForSync: () => {},
	},
	extensionUri: { fsPath: "/mock/extension/path" },
	globalStorageUri: { fsPath: "/mock/settings/path" },
	asAbsolutePath: (relativePath: string) => `/mock/extension/path/${relativePath}`,
	extension: {
		packageJSON: {
			version: "1.0.0",
		},
	},
} as unknown as vscode.ExtensionContext

// Create a minimal mock of ClineProvider
const mockProvider = {
	ensureMcpServersDirectoryExists: async () => "/mock/mcp/path",
	ensureSettingsDirectoryExists: async () => "/mock/settings/path",
	postMessageToWebview: async () => {},
	context: mockContext,
} as unknown as ClineProvider

// Instead of extending McpHub, create a mock that implements just what we need
const createMockMcpHub = (): McpHub =>
	({
		getServers: () => [],
		getMcpServersPath: async () => "/mock/mcp/path",
		getMcpSettingsFilePath: async () => "/mock/settings/path",
		dispose: async () => {},
		// Add other required public methods with no-op implementations
		restartConnection: async () => {},
		readResource: async () => ({ contents: [] }),
		callTool: async () => ({ content: [] }),
		toggleServerDisabled: async () => {},
		toggleToolAlwaysAllow: async () => {},
		isConnecting: false,
		connections: [],
	}) as unknown as McpHub

describe("SYSTEM_PROMPT", () => {
	let mockMcpHub: McpHub
	let experiments: Record<string, boolean> | undefined

	beforeAll(() => {
		// Ensure fs mock is properly initialized
		const mockFs = jest.requireMock("fs/promises")
		mockFs._setInitialMockData()

		// Initialize all required directories
		const dirs = [
			"/mock",
			"/mock/extension",
			"/mock/extension/path",
			"/mock/storage",
			"/mock/storage/path",
			"/mock/settings",
			"/mock/settings/path",
			"/mock/mcp",
			"/mock/mcp/path",
		]
		dirs.forEach((dir) => mockFs._mockDirectories.add(dir))
	})

	beforeEach(() => {
		// Reset experiments before each test to ensure they're disabled by default
		experiments = {
			[EXPERIMENT_IDS.SEARCH_AND_REPLACE]: false,
			[EXPERIMENT_IDS.INSERT_BLOCK]: false,
		}
	})

	beforeEach(() => {
		jest.clearAllMocks()
	})

	afterEach(async () => {
		// Clean up any McpHub instances
		if (mockMcpHub) {
			await mockMcpHub.dispose()
		}
	})

	it("should maintain consistent system prompt", async () => {
		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false, // supportsComputerUse
			undefined, // mcpHub
			undefined, // diffStrategy
			undefined, // browserViewportSize
			defaultModeSlug, // mode
			undefined, // customModePrompts
			undefined, // customModes
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			experiments,
			true, // enableMcpServerCreation
		)

		expect(prompt).toMatchSnapshot()
	})

	it("should include browser actions when supportsComputerUse is true", async () => {
		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			true, // supportsComputerUse
			undefined, // mcpHub
			undefined, // diffStrategy
			"1280x800", // browserViewportSize
			defaultModeSlug, // mode
			undefined, // customModePrompts
			undefined, // customModes,
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			experiments,
			true, // enableMcpServerCreation
		)

		expect(prompt).toMatchSnapshot()
	})

	it("should include MCP server info when mcpHub is provided", async () => {
		mockMcpHub = createMockMcpHub()

		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false, // supportsComputerUse
			mockMcpHub, // mcpHub
			undefined, // diffStrategy
			undefined, // browserViewportSize
			defaultModeSlug, // mode
			undefined, // customModePrompts
			undefined, // customModes,
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			experiments,
			true, // enableMcpServerCreation
		)

		expect(prompt).toMatchSnapshot()
	})

	it("should explicitly handle undefined mcpHub", async () => {
		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false, // supportsComputerUse
			undefined, // explicitly undefined mcpHub
			undefined, // diffStrategy
			undefined, // browserViewportSize
			defaultModeSlug, // mode
			undefined, // customModePrompts
			undefined, // customModes,
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			experiments,
			true, // enableMcpServerCreation
		)

		expect(prompt).toMatchSnapshot()
	})

	it("should handle different browser viewport sizes", async () => {
		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			true, // supportsComputerUse
			undefined, // mcpHub
			undefined, // diffStrategy
			"900x600", // different viewport size
			defaultModeSlug, // mode
			undefined, // customModePrompts
			undefined, // customModes,
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			experiments,
			true, // enableMcpServerCreation
		)

		expect(prompt).toMatchSnapshot()
	})

	it("should include diff strategy tool description when diffEnabled is true", async () => {
		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false, // supportsComputerUse
			undefined, // mcpHub
			new MultiSearchReplaceDiffStrategy(), // Use actual diff strategy from the codebase
			undefined, // browserViewportSize
			defaultModeSlug, // mode
			undefined, // customModePrompts
			undefined, // customModes
			undefined, // globalCustomInstructions
			true, // diffEnabled
			experiments,
			true, // enableMcpServerCreation
		)

		expect(prompt).toContain("apply_diff")
		expect(prompt).toMatchSnapshot()
	})

	it("should exclude diff strategy tool description when diffEnabled is false", async () => {
		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false, // supportsComputerUse
			undefined, // mcpHub
			new MultiSearchReplaceDiffStrategy(), // Use actual diff strategy from the codebase
			undefined, // browserViewportSize
			defaultModeSlug, // mode
			undefined, // customModePrompts
			undefined, // customModes
			undefined, // globalCustomInstructions
			false, // diffEnabled
			experiments,
			true, // enableMcpServerCreation
		)

		expect(prompt).not.toContain("apply_diff")
		expect(prompt).toMatchSnapshot()
	})

	it("should exclude diff strategy tool description when diffEnabled is undefined", async () => {
		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false, // supportsComputerUse
			undefined, // mcpHub
			new MultiSearchReplaceDiffStrategy(), // Use actual diff strategy from the codebase
			undefined, // browserViewportSize
			defaultModeSlug, // mode
			undefined, // customModePrompts
			undefined, // customModes
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			experiments,
			true, // enableMcpServerCreation
		)

		expect(prompt).not.toContain("apply_diff")
		expect(prompt).toMatchSnapshot()
	})

	it("should include vscode language in custom instructions", async () => {
		// Mock vscode.env.language
		const vscode = jest.requireMock("vscode")
		vscode.env = { language: "es" }

		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false, // supportsComputerUse
			undefined, // mcpHub
			undefined, // diffStrategy
			undefined, // browserViewportSize
			defaultModeSlug, // mode
			undefined, // customModePrompts
			undefined, // customModes
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			undefined, // experiments
			true, // enableMcpServerCreation
		)

		expect(prompt).toContain("Language Preference:")
		expect(prompt).toContain('You should always speak and think in the "es" language')

		// Reset mock
		vscode.env = { language: "en" }
	})

	it("should include custom mode role definition at top and instructions at bottom", async () => {
		const modeCustomInstructions = "Custom mode instructions"

		const customModes: ModeConfig[] = [
			{
				slug: "custom-mode",
				name: "Custom Mode",
				roleDefinition: "Custom role definition",
				customInstructions: modeCustomInstructions,
				groups: ["read"] as const,
			},
		]

		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false, // supportsComputerUse
			undefined, // mcpHub
			undefined, // diffStrategy
			undefined, // browserViewportSize
			"custom-mode", // mode
			undefined, // customModePrompts
			customModes, // customModes
			"Global instructions", // globalCustomInstructions
			undefined, // diffEnabled
			experiments,
			true, // enableMcpServerCreation
		)

		// Role definition should be at the top
		expect(prompt.indexOf("Custom role definition")).toBeLessThan(prompt.indexOf("TOOL USE"))

		// Custom instructions should be at the bottom
		const customInstructionsIndex = prompt.indexOf("Custom mode instructions")
		const userInstructionsHeader = prompt.indexOf("USER'S CUSTOM INSTRUCTIONS")
		expect(customInstructionsIndex).toBeGreaterThan(-1)
		expect(userInstructionsHeader).toBeGreaterThan(-1)
		expect(customInstructionsIndex).toBeGreaterThan(userInstructionsHeader)
	})

	it("should use promptComponent roleDefinition when available", async () => {
		const customModePrompts = {
			[defaultModeSlug]: {
				roleDefinition: "Custom prompt role definition",
				customInstructions: "Custom prompt instructions",
			},
		}

		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false, // supportsComputerUse
			undefined, // mcpHub
			undefined, // diffStrategy
			undefined, // browserViewportSize
			defaultModeSlug as Mode, // mode
			customModePrompts, // customModePrompts
			undefined, // customModes
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			undefined, // experiments
			false, // enableMcpServerCreation
		)

		// Role definition from promptComponent should be at the top
		expect(prompt.indexOf("Custom prompt role definition")).toBeLessThan(prompt.indexOf("TOOL USE"))
		// Should not contain the default mode's role definition
		expect(prompt).not.toContain(modes[0].roleDefinition)
	})

	it("should fallback to modeConfig roleDefinition when promptComponent has no roleDefinition", async () => {
		const customModePrompts = {
			[defaultModeSlug]: {
				customInstructions: "Custom prompt instructions",
				// No roleDefinition provided
			},
		}

		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false, // supportsComputerUse
			undefined, // mcpHub
			undefined, // diffStrategy
			undefined, // browserViewportSize
			defaultModeSlug as Mode, // mode
			customModePrompts, // customModePrompts
			undefined, // customModes
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			undefined, // experiments
			false, // enableMcpServerCreation
		)

		// Should use the default mode's role definition
		expect(prompt.indexOf(modes[0].roleDefinition)).toBeLessThan(prompt.indexOf("TOOL USE"))
	})

	it("should substitute placeholders in file-based custom system prompts", async () => {
		// Mock loadSystemPromptFile to return a template
		const mockLoadSystemPromptFile = jest.requireMock("../sections/custom-system-prompt").loadSystemPromptFile
		const filePromptTemplate = `Custom Role: {{ROLE_DEFINITION}}

This is my custom prompt file.

Tools Available:
{{TOOL_DESCRIPTIONS}}

Guidelines:
{{TOOL_USE_GUIDELINES}}

My Instructions:
{{CUSTOM_INSTRUCTIONS_SECTION}}

System Info: {{SYSTEM_INFO_SECTION}}
Objective: {{OBJECTIVE_SECTION}}
Unknown Placeholder: {{UNKNOWN_PLACEHOLDER}}`
		mockLoadSystemPromptFile.mockResolvedValue(filePromptTemplate)

		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			true, // supportsComputerUse
			undefined, // mcpHub
			new MultiSearchReplaceDiffStrategy(), // diffStrategy
			"1024x768", // browserViewportSize
			"code", // mode
			undefined, // customModePrompts
			undefined, // customModes
			"Global custom instructions for file prompt test", // globalCustomInstructions
			true, // diffEnabled
			undefined, // experiments
			false, // enableMcpServerCreation
			"fr", // language
			"Mock rooignore instructions", // rooIgnoreInstructions
		)

		// Check that known placeholders are replaced
		expect(prompt).toContain("Custom Role: You are Roo") // Assuming 'code' mode role def starts like this
		expect(prompt).toContain("Tools Available:")
		expect(prompt).toContain("## read_file") // Check if tool descriptions are inserted
		expect(prompt).toContain("Guidelines:")
		expect(prompt).toContain("1. In <thinking> tags") // Check if guidelines are inserted
		expect(prompt).toContain("My Instructions:")
		expect(prompt).toContain("Global custom instructions for file prompt test") // Check custom instructions
		expect(prompt).toContain("System Info: ====") // Check system info section start
		expect(prompt).toContain("Objective: ====") // Check objective section start

		// Check that unknown placeholders remain untouched
		expect(prompt).toContain("Unknown Placeholder: {{UNKNOWN_PLACEHOLDER}}")

		// Snapshot the result
		expect(prompt).toMatchSnapshot()

		// Reset mock for other tests
		mockLoadSystemPromptFile.mockResolvedValue(null)
	})

	describe("experimental tools", () => {
		it("should disable experimental tools by default", async () => {
			// Set experiments to explicitly disable experimental tools
			const experimentsConfig = {
				[EXPERIMENT_IDS.SEARCH_AND_REPLACE]: false,
				[EXPERIMENT_IDS.INSERT_BLOCK]: false,
			}

			// Reset experiments
			experiments = experimentsConfig

			const prompt = await SYSTEM_PROMPT(
				mockContext,
				"/test/path",
				false, // supportsComputerUse
				undefined, // mcpHub
				undefined, // diffStrategy
				undefined, // browserViewportSize
				defaultModeSlug, // mode
				undefined, // customModePrompts
				undefined, // customModes
				undefined, // globalCustomInstructions
				undefined, // diffEnabled
				experimentsConfig, // Explicitly disable experimental tools
				true, // enableMcpServerCreation
			)

			// Check that experimental tool sections are not included
			const toolSections = prompt.split("\n## ").slice(1)
			const toolNames = toolSections.map((section) => section.split("\n")[0].trim())
			expect(toolNames).not.toContain("search_and_replace")
			expect(toolNames).not.toContain("insert_content")
			expect(prompt).toMatchSnapshot()
		})

		it("should enable experimental tools when explicitly enabled", async () => {
			// Set experiments for testing experimental features
			const experimentsEnabled = {
				[EXPERIMENT_IDS.SEARCH_AND_REPLACE]: true,
				[EXPERIMENT_IDS.INSERT_BLOCK]: true,
			}

			// Reset default experiments
			experiments = undefined

			const prompt = await SYSTEM_PROMPT(
				mockContext,
				"/test/path",
				false, // supportsComputerUse
				undefined, // mcpHub
				undefined, // diffStrategy
				undefined, // browserViewportSize
				defaultModeSlug, // mode
				undefined, // customModePrompts
				undefined, // customModes
				undefined, // globalCustomInstructions
				undefined, // diffEnabled
				experimentsEnabled, // Use the enabled experiments
				true, // enableMcpServerCreation
			)

			// Get all tool sections
			const toolSections = prompt.split("## ").slice(1) // Split by section headers and remove first non-tool part
			const toolNames = toolSections.map((section) => section.split("\n")[0].trim())

			// Verify experimental tools are included in the prompt when enabled
			expect(toolNames).toContain("search_and_replace")
			expect(toolNames).toContain("insert_content")
			expect(prompt).toMatchSnapshot()
		})

		it("should selectively enable experimental tools", async () => {
			// Set experiments for testing selective enabling
			const experimentsSelective = {
				[EXPERIMENT_IDS.SEARCH_AND_REPLACE]: true,
				[EXPERIMENT_IDS.INSERT_BLOCK]: false,
			}

			// Reset default experiments
			experiments = undefined

			const prompt = await SYSTEM_PROMPT(
				mockContext,
				"/test/path",
				false, // supportsComputerUse
				undefined, // mcpHub
				undefined, // diffStrategy
				undefined, // browserViewportSize
				defaultModeSlug, // mode
				undefined, // customModePrompts
				undefined, // customModes
				undefined, // globalCustomInstructions
				undefined, // diffEnabled
				experimentsSelective, // Use the selective experiments
				true, // enableMcpServerCreation
			)

			// Get all tool sections
			const toolSections = prompt.split("## ").slice(1) // Split by section headers and remove first non-tool part
			const toolNames = toolSections.map((section) => section.split("\n")[0].trim())

			// Verify only enabled experimental tools are included
			expect(toolNames).toContain("search_and_replace")
			expect(toolNames).not.toContain("insert_content")
			expect(prompt).toMatchSnapshot()
		})

		it("should list all available editing tools in base instruction", async () => {
			const experiments = {
				[EXPERIMENT_IDS.SEARCH_AND_REPLACE]: true,
				[EXPERIMENT_IDS.INSERT_BLOCK]: true,
			}

			const prompt = await SYSTEM_PROMPT(
				mockContext,
				"/test/path",
				false,
				undefined,
				new MultiSearchReplaceDiffStrategy(),
				undefined,
				defaultModeSlug,
				undefined,
				undefined,
				undefined,
				true, // diffEnabled
				experiments, // experiments
				true, // enableMcpServerCreation
			)

			// Verify base instruction lists all available tools
			expect(prompt).toContain("apply_diff (for replacing lines in existing files)")
			expect(prompt).toContain("write_to_file (for creating new files or complete file rewrites)")
			expect(prompt).toContain("insert_content (for adding lines to existing files)")
			expect(prompt).toContain("search_and_replace (for finding and replacing individual pieces of text)")
		})
		it("should provide detailed instructions for each enabled tool", async () => {
			const experiments = {
				[EXPERIMENT_IDS.SEARCH_AND_REPLACE]: true,
				[EXPERIMENT_IDS.INSERT_BLOCK]: true,
			}

			const prompt = await SYSTEM_PROMPT(
				mockContext,
				"/test/path",
				false,
				undefined,
				new MultiSearchReplaceDiffStrategy(),
				undefined,
				defaultModeSlug,
				undefined,
				undefined,
				undefined,
				true, // diffEnabled
				experiments,
				true, // enableMcpServerCreation
			)

			// Verify detailed instructions for each tool
			expect(prompt).toContain(
				"You should always prefer using other editing tools over write_to_file when making changes to existing files since write_to_file is much slower and cannot handle large files.",
			)
			expect(prompt).toContain("The insert_content tool adds lines of text to files")
			expect(prompt).toContain("The search_and_replace tool finds and replaces text or regex in files")
		})
	})

	afterAll(() => {
		jest.restoreAllMocks()
	})
})

describe("addCustomInstructions", () => {
	let experiments: Record<string, boolean> | undefined
	beforeAll(() => {
		// Ensure fs mock is properly initialized
		const mockFs = jest.requireMock("fs/promises")
		mockFs._setInitialMockData()
		mockFs.mkdir.mockImplementation(async (path: string) => {
			if (path.startsWith("/test")) {
				mockFs._mockDirectories.add(path)
				return Promise.resolve()
			}
			throw new Error(`ENOENT: no such file or directory, mkdir '${path}'`)
		})

		// Initialize experiments as undefined by default
		experiments = undefined
	})

	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("should generate correct prompt for architect mode", async () => {
		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false, // supportsComputerUse
			undefined, // mcpHub
			undefined, // diffStrategy
			undefined, // browserViewportSize
			"architect", // mode
			undefined, // customModePrompts
			undefined, // customModes
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			undefined, // experiments
			true, // enableMcpServerCreation
		)

		expect(prompt).toMatchSnapshot()
	})

	it("should generate correct prompt for ask mode", async () => {
		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false, // supportsComputerUse
			undefined, // mcpHub
			undefined, // diffStrategy
			undefined, // browserViewportSize
			"ask", // mode
			undefined, // customModePrompts
			undefined, // customModes
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			undefined, // experiments
			true, // enableMcpServerCreation
		)

		expect(prompt).toMatchSnapshot()
	})

	it("should include MCP server creation info when enabled", async () => {
		const mockMcpHub = createMockMcpHub()

		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false, // supportsComputerUse
			mockMcpHub, // mcpHub
			undefined, // diffStrategy
			undefined, // browserViewportSize
			defaultModeSlug, // mode
			undefined, // customModePrompts
			undefined, // customModes,
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			undefined, // experiments
			true, // enableMcpServerCreation
		)

		expect(prompt).toContain("Creating an MCP Server")
		expect(prompt).toMatchSnapshot()
	})

	it("should exclude MCP server creation info when disabled", async () => {
		const mockMcpHub = createMockMcpHub()

		const prompt = await SYSTEM_PROMPT(
			mockContext,
			"/test/path",
			false, // supportsComputerUse
			mockMcpHub, // mcpHub
			undefined, // diffStrategy
			undefined, // browserViewportSize
			defaultModeSlug, // mode
			undefined, // customModePrompts
			undefined, // customModes,
			undefined, // globalCustomInstructions
			undefined, // diffEnabled
			undefined, // experiments
			false, // enableMcpServerCreation
		)

		expect(prompt).not.toContain("Creating an MCP Server")
		expect(prompt).toMatchSnapshot()
	})

	it("should prioritize mode-specific rules for code mode", async () => {
		const instructionsResult = await addCustomInstructions("", "", "/test/path", defaultModeSlug)
		// Snapshot the entire result object
		expect(instructionsResult).toMatchSnapshot()
	})

	it("should prioritize mode-specific rules for ask mode", async () => {
		const instructionsResult = await addCustomInstructions("", "", "/test/path", modes[2].slug)
		expect(instructionsResult).toMatchSnapshot()
	})

	it("should prioritize mode-specific rules for architect mode", async () => {
		const instructionsResult = await addCustomInstructions("", "", "/test/path", modes[1].slug)
		expect(instructionsResult).toMatchSnapshot()
	})

	it("should prioritize mode-specific rules for test engineer mode", async () => {
		const instructionsResult = await addCustomInstructions("", "", "/test/path", "test")
		expect(instructionsResult).toMatchSnapshot()
	})

	it("should prioritize mode-specific rules for code reviewer mode", async () => {
		const instructionsResult = await addCustomInstructions("", "", "/test/path", "review")
		expect(instructionsResult).toMatchSnapshot()
	})

	it("should fall back to generic rules when mode-specific rules not found", async () => {
		const instructionsResult = await addCustomInstructions("", "", "/test/path", defaultModeSlug)
		// Snapshot the entire result object
		expect(instructionsResult).toMatchSnapshot()
	})

	it("should include preferred language when provided", async () => {
		const instructionsResult = await addCustomInstructions("", "", "/test/path", defaultModeSlug, {
			language: "es",
		})
		expect(instructionsResult).toMatchSnapshot() // Snapshot the object
	})

	it("should include custom instructions when provided", async () => {
		const instructionsResult = await addCustomInstructions(
			"Custom test instructions",
			"",
			"/test/path",
			defaultModeSlug,
		)
		expect(instructionsResult).toMatchSnapshot()
	})

	it("should combine all custom instructions", async () => {
		const instructionsResult = await addCustomInstructions(
			"Custom test instructions",
			"",
			"/test/path",
			defaultModeSlug,
			{ language: "fr" },
		)
		expect(instructionsResult).toMatchSnapshot() // Snapshot the object
	})

	it("should handle undefined mode-specific instructions", async () => {
		const instructionsResult = await addCustomInstructions("", "", "/test/path", defaultModeSlug)
		expect(instructionsResult).toMatchSnapshot()
	})

	it("should trim mode-specific instructions", async () => {
		const instructionsResult = await addCustomInstructions(
			"  Custom mode instructions  ",
			"",
			"/test/path",
			defaultModeSlug,
		)
		expect(instructionsResult).toMatchSnapshot() // Snapshot the object
	})

	it("should handle empty mode-specific instructions", async () => {
		const instructionsResult = await addCustomInstructions("", "", "/test/path", defaultModeSlug)
		expect(instructionsResult).toMatchSnapshot()
	})

	it("should combine global and mode-specific instructions", async () => {
		const instructionsResult = await addCustomInstructions(
			"Mode-specific instructions",
			"Global instructions",
			"/test/path",
			defaultModeSlug,
		)
		expect(instructionsResult).toMatchSnapshot() // Snapshot the object
	})

	it("should prioritize mode-specific instructions after global ones", async () => {
		const instructionsResult = await addCustomInstructions(
			"Second instruction",
			"First instruction",
			"/test/path",
			defaultModeSlug,
		)
		const instructions = instructionsResult.fullSection // Get the full string for splitting

		const instructionParts = instructions.split("\n\n")
		const globalIndex = instructionParts.findIndex((part) => part.includes("First instruction"))
		const modeSpecificIndex = instructionParts.findIndex((part) => part.includes("Second instruction"))

		expect(globalIndex).toBeLessThan(modeSpecificIndex)
		expect(instructionsResult).toMatchSnapshot() // Snapshot the object
	})

	afterAll(() => {
		jest.restoreAllMocks()
	})
})
