import * as vscode from "vscode"
import { Cline } from "../../Cline"
import { ToolUse } from "../../assistant-message"
import { writeFilesTool } from "../writeFilesTool" // Import the new tool function
import { AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../types"
import * as pathUtils from "../../../utils/pathUtils"
import * as fsUtils from "../../../utils/fs"

// Mocks
jest.mock("../../Cline")
jest.mock("../../../utils/pathUtils")
jest.mock("../../../utils/fs")
// Mock vscode.workspace.fs API
// Declare mock variables at the top level
let mockWriteFile: jest.Mock
let mockCreateDirectory: jest.Mock
jest.mock(
	"vscode",
	() => ({
		workspace: {
			fs: {
				// Reference the variables declared above
				writeFile: (...args: any[]) => mockWriteFile(...args),
				createDirectory: (...args: any[]) => mockCreateDirectory(...args),
			},
		},
		window: {
			// Add mock for window object
			createTextEditorDecorationType: jest.fn().mockReturnValue({ key: "mockDecorationType" }), // Mock the necessary function
		},
		Uri: {
			// Use forward slashes for the 'path' property in the mock URI object
			file: (p: string) => ({ fsPath: p, path: p.replace(/\\/g, "/"), scheme: "file" }),
		},
		FileSystemError: {
			FileNotFound: () => new Error("FileNotFound"), // Mock specific error types if needed
		},
	}),
	{ virtual: true },
) // Need virtual: true for VS Code API mocks

describe("writeFilesTool", () => {
	let mockCline: jest.Mocked<Cline>
	let mockBlock: ToolUse
	let mockAskApproval: jest.MockedFunction<AskApproval>
	let mockHandleError: jest.MockedFunction<HandleError>
	let mockPushToolResult: jest.MockedFunction<PushToolResult>
	let mockRemoveClosingTag: jest.MockedFunction<RemoveClosingTag>

	beforeEach(() => {
		jest.clearAllMocks()
		// Initialize the mock functions here
		mockWriteFile = jest.fn()
		mockCreateDirectory = jest.fn()

		mockCline = new Cline({} as any) as jest.Mocked<Cline>
		Object.defineProperty(mockCline, "cwd", { get: jest.fn(() => "C:/test/workspace") }) // Use absolute path
		mockCline.consecutiveMistakeCount = 0
		mockCline.sayAndCreateMissingParamError = jest.fn().mockResolvedValue("Missing param error")
		mockCline.say = jest.fn().mockResolvedValue(undefined)
		mockCline.rooIgnoreController = {
			validateAccess: jest.fn().mockReturnValue(true),
		} as any
		mockCline.providerRef = {
			deref: jest.fn().mockReturnValue({
				getState: jest.fn().mockResolvedValue({}), // No specific state needed for write
			}),
		} as any

		mockAskApproval = jest.fn().mockResolvedValue(true)
		mockHandleError = jest.fn()
		mockPushToolResult = jest.fn()
		mockRemoveClosingTag = jest.fn((_tag, text) => text || "")
		;(pathUtils.isPathOutsideWorkspace as jest.Mock).mockReturnValue(false)
		;(fsUtils.fileExistsAtPath as jest.Mock).mockResolvedValue(false) // Assume files don't exist by default (create case)
		// Configure the mock functions defined above
		mockWriteFile.mockClear()
		mockWriteFile.mockResolvedValue(undefined) // Assume write succeeds
		mockCreateDirectory.mockClear()
		mockCreateDirectory.mockResolvedValue(undefined) // Assume directory creation succeeds

		mockBlock = {
			type: "tool_use",
			name: "write_files",
			params: {
				items: [
					{ path: "newFile1.txt", content: "Content 1" },
					{ path: "subdir/newFile2.js", content: "console.log('hello');" },
				],
			},
			partial: false,
		}
	})

	it("should call askApproval with correct batch paths and statuses", async () => {
		;(fsUtils.fileExistsAtPath as jest.Mock)
			.mockResolvedValueOnce(false) // newFile1.txt doesn't exist
			.mockResolvedValueOnce(true) // subdir/newFile2.js exists

		mockBlock.params.items = [
			{ path: "newFile1.txt", content: "Content 1" },
			{ path: "subdir/newFile2.js", content: "console.log('hello');" },
		]

		await writeFilesTool(
			mockCline,
			mockBlock,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		expect(mockAskApproval).toHaveBeenCalledTimes(1)
		const approvalContent = JSON.parse(mockAskApproval.mock.calls[0][1] || "{}")
		expect(approvalContent.tool).toBe("writeFiles")
		// Expect absolute paths normalized with forward slashes
		expect(approvalContent.paths).toEqual([
			{ path: "C:/test/workspace/newFile1.txt", isOutsideWorkspace: false, status: "create" },
			{ path: "C:/test/workspace/subdir/newFile2.js", isOutsideWorkspace: false, status: "overwrite" },
		])
		expect(approvalContent.reason).toContain("Will create 1 new file(s) and overwrite 1 existing file(s).")
	})

	it("should write multiple files and push combined XML result", async () => {
		await writeFilesTool(
			mockCline,
			mockBlock,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		expect(mockCreateDirectory).toHaveBeenCalledTimes(2) // Called for workspace root and subdir
		// Check mock calls with absolute paths (Uri mock uses forward slashes for path)
		expect(mockCreateDirectory).toHaveBeenCalledWith(
			expect.objectContaining({ path: "C:/test/workspace", scheme: "file" }),
		) // Called for parent of newFile1.txt
		expect(mockCreateDirectory).toHaveBeenCalledWith(
			expect.objectContaining({ path: "C:/test/workspace/subdir", scheme: "file" }),
		) // Called for parent of subdir/newFile2.js
		expect(mockWriteFile).toHaveBeenCalledTimes(2)
		expect(mockWriteFile).toHaveBeenCalledWith(
			expect.objectContaining({ path: "C:/test/workspace/newFile1.txt", scheme: "file" }),
			expect.any(Uint8Array),
		)
		expect(mockWriteFile).toHaveBeenCalledWith(
			expect.objectContaining({ path: "C:/test/workspace/subdir/newFile2.js", scheme: "file" }),
			expect.any(Uint8Array),
		)
		expect(mockPushToolResult).toHaveBeenCalledTimes(1)
		const resultXml = mockPushToolResult.mock.calls[0][0]
		expect(resultXml).toContain("<write_results>")
		// Use toMatch with regex to ignore whitespace variations
		expect(resultXml).toMatch(/<file>\s*<path>newFile1\.txt<\/path>\s*<status>success<\/status>\s*<\/file>/)
		expect(resultXml).toMatch(/<file>\s*<path>subdir\/newFile2\.js<\/path>\s*<status>success<\/status>\s*<\/file>/)
		expect(resultXml).toContain("</write_results>")
		expect(mockHandleError).not.toHaveBeenCalled()
		expect(mockCline.say).toHaveBeenCalledWith("text", expect.stringContaining("2 file(s) written successfully"))
	})

	it("should handle errors when writing one file and continue with others", async () => {
		const error = new Error("Disk full")
		mockWriteFile.mockResolvedValueOnce(undefined).mockRejectedValueOnce(error) // First write succeeds, second fails

		await writeFilesTool(
			mockCline,
			mockBlock,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		expect(mockWriteFile).toHaveBeenCalledTimes(2)
		expect(mockPushToolResult).toHaveBeenCalledTimes(1)
		const resultXml = mockPushToolResult.mock.calls[0][0]
		expect(resultXml).toContain("<write_results>")
		// Use toMatch with regex to ignore whitespace variations
		expect(resultXml).toMatch(/<file>\s*<path>newFile1\.txt<\/path>\s*<status>success<\/status>\s*<\/file>/)
		expect(resultXml).toMatch(
			/<file>\s*<path>subdir\/newFile2\.js<\/path>\s*<status>error<\/status>\s*<error>Disk full<\/error>\s*<\/file>/,
		)
		expect(resultXml).toContain("</write_results>")
		expect(mockHandleError).toHaveBeenCalledWith("writing file subdir/newFile2.js", error)
		expect(mockCline.say).toHaveBeenCalledWith(
			"text",
			expect.stringContaining("1 file(s) written successfully. 1 file(s) failed to write."),
		)
	})

	it("should return error if items parameter is missing or invalid", async () => {
		mockBlock.params.items = undefined // Missing items
		await writeFilesTool(
			mockCline,
			mockBlock,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)
		expect(mockPushToolResult).toHaveBeenCalledWith("Missing param error")
		expect(mockCline.sayAndCreateMissingParamError).toHaveBeenCalledWith("write_files", "items", expect.any(String))

		mockBlock.params.items = [{ path: "good.txt" }, { content: "bad" }] // Invalid items
		await writeFilesTool(
			mockCline,
			mockBlock,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)
		expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Invalid 'items' parameter"))
		expect(mockCline.say).toHaveBeenCalledWith("error", expect.stringContaining("missing 'content'"))
		expect(mockCline.say).toHaveBeenCalledWith("error", expect.stringContaining("missing a valid 'path'"))
	})

	it("should return error if .rooignore prevents access", async () => {
		;(mockCline.rooIgnoreController?.validateAccess as jest.Mock).mockReturnValue(false) // Disallow access

		await writeFilesTool(
			mockCline,
			mockBlock,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		// Match the actual error message observed in test output
		expect(mockPushToolResult).toHaveBeenCalledWith(
			expect.stringContaining(
				"Access to newFile1.txt, subdir/newFile2.js is blocked by the .rooignore file settings.",
			),
		)
		expect(mockCline.say).toHaveBeenCalledWith("rooignore_error", expect.any(String))
		expect(mockAskApproval).not.toHaveBeenCalled()
	})

	it("should not proceed if user denies approval", async () => {
		mockAskApproval.mockResolvedValue(false) // User denies

		await writeFilesTool(
			mockCline,
			mockBlock,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		expect(mockAskApproval).toHaveBeenCalledTimes(1)
		expect(mockWriteFile).not.toHaveBeenCalled()
		expect(mockPushToolResult).not.toHaveBeenCalled()
		expect(mockHandleError).not.toHaveBeenCalled()
	})

	// Add more tests for edge cases: empty content, creating deep directories, etc.
	it("should correctly write files with empty content", async () => {
		mockBlock.params.items = [
			{ path: "emptyFile.txt", content: "" },
			{ path: "anotherEmpty.js", content: "" },
		]

		await writeFilesTool(
			mockCline,
			mockBlock,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		expect(mockWriteFile).toHaveBeenCalledTimes(2)
		// Check that writeFile was called with an empty Uint8Array (or equivalent check)
		// Check mock calls with absolute paths
		expect(mockWriteFile).toHaveBeenCalledWith(
			expect.objectContaining({ path: "C:/test/workspace/emptyFile.txt", scheme: "file" }),
			new Uint8Array([]),
		)
		expect(mockWriteFile).toHaveBeenCalledWith(
			expect.objectContaining({ path: "C:/test/workspace/anotherEmpty.js", scheme: "file" }),
			new Uint8Array([]),
		)
		expect(mockPushToolResult).toHaveBeenCalledTimes(1)
		const resultXml = mockPushToolResult.mock.calls[0][0]
		// Use toMatch with regex to ignore whitespace variations
		expect(resultXml).toMatch(/<file>\s*<path>emptyFile\.txt<\/path>\s*<status>success<\/status>\s*<\/file>/)
		expect(resultXml).toMatch(/<file>\s*<path>anotherEmpty\.js<\/path>\s*<status>success<\/status>\s*<\/file>/)
		expect(mockHandleError).not.toHaveBeenCalled()
		expect(mockCline.say).toHaveBeenCalledWith("text", expect.stringContaining("2 file(s) written successfully"))
	})

	it("should create deep directories when necessary", async () => {
		const deepPath = "a/b/c/deepFile.txt"
		mockBlock.params.items = [{ path: deepPath, content: "Deep content" }]

		// Assume the file and directories don't exist
		;(fsUtils.fileExistsAtPath as jest.Mock).mockResolvedValue(false)
		// Mock getDirectory to return the parent directory

		await writeFilesTool(
			mockCline,
			mockBlock,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		// Check that createDirectory was called for the deepest required directory
		// The implementation likely uses recursive creation, so we check the final dir
		expect(mockCreateDirectory).toHaveBeenCalledTimes(1)
		// Check mock call with absolute path URI object
		expect(mockCreateDirectory).toHaveBeenCalledWith(
			expect.objectContaining({ path: "C:/test/workspace/a/b/c", scheme: "file" }),
		)

		// Check that writeFile was called correctly
		expect(mockWriteFile).toHaveBeenCalledTimes(1)
		// Check mock call with absolute path URI object
		expect(mockWriteFile).toHaveBeenCalledWith(
			expect.objectContaining({ path: `C:/test/workspace/${deepPath}`, scheme: "file" }),
			expect.any(Uint8Array),
		)

		// Check the result
		expect(mockPushToolResult).toHaveBeenCalledTimes(1)
		const resultXml = mockPushToolResult.mock.calls[0][0]
		// Use toMatch with regex to ignore whitespace variations and escape path separators
		const escapedPath = deepPath.replace(/\//g, "\\/") // Escape forward slashes for regex
		expect(resultXml).toMatch(
			new RegExp(`<file>\\s*<path>${escapedPath}<\\/path>\\s*<status>success<\\/status>\\s*<\\/file>`),
		)
		expect(mockHandleError).not.toHaveBeenCalled()
		expect(mockCline.say).toHaveBeenCalledWith("text", expect.stringContaining("1 file(s) written successfully"))
	})
})
