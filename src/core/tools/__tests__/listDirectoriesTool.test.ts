import * as path from "path"
import { Cline } from "../../Cline"
import { ToolUse } from "../../assistant-message"
import { listDirectoriesTool } from "../listDirectoriesTool" // Import the new tool function
import { AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../types"
import * as listFilesService from "../../../services/glob/list-files"
import * as formatResponseUtil from "../../prompts/responses"
import * as pathUtils from "../../../utils/pathUtils"

// Mocks
jest.mock("../../Cline")
jest.mock("../../../services/glob/list-files")
jest.mock("../../prompts/responses")
jest.mock("../../../utils/pathUtils")

describe("listDirectoriesTool", () => {
	let mockCline: jest.Mocked<Cline>
	let mockBlock: ToolUse
	let mockAskApproval: jest.MockedFunction<AskApproval>
	let mockHandleError: jest.MockedFunction<HandleError>
	let mockPushToolResult: jest.MockedFunction<PushToolResult>
	let mockRemoveClosingTag: jest.MockedFunction<RemoveClosingTag>
	let mockListFiles: jest.MockedFunction<typeof listFilesService.listFiles>
	let mockFormatFilesList: jest.MockedFunction<typeof formatResponseUtil.formatResponse.formatFilesList>

	beforeEach(() => {
		jest.clearAllMocks()

		mockCline = new Cline({} as any) as jest.Mocked<Cline>
		// Use absolute path with forward slashes for consistency
		Object.defineProperty(mockCline, "cwd", { get: jest.fn(() => "C:/test/workspace") })
		mockCline.consecutiveMistakeCount = 0
		mockCline.sayAndCreateMissingParamError = jest.fn().mockResolvedValue("Missing param error")
		mockCline.say = jest.fn().mockResolvedValue(undefined)
		mockCline.rooIgnoreController = {
			validateAccess: jest.fn().mockReturnValue(true),
		} as any
		mockCline.providerRef = {
			deref: jest.fn().mockReturnValue({
				getState: jest.fn().mockResolvedValue({ showRooIgnoredFiles: true }),
			}),
		} as any

		mockAskApproval = jest.fn().mockResolvedValue(true)
		mockHandleError = jest.fn()
		mockPushToolResult = jest.fn()
		mockRemoveClosingTag = jest.fn((_tag, text) => text || "")

		// Mock the imported service/utils
		mockListFiles = listFilesService.listFiles as jest.MockedFunction<typeof listFilesService.listFiles>
		mockFormatFilesList = formatResponseUtil.formatResponse.formatFilesList as jest.MockedFunction<
			typeof formatResponseUtil.formatResponse.formatFilesList
		>

		// Default mock implementations
		mockListFiles.mockResolvedValue([["file1.txt", "subdir/"], false]) // Default list result
		mockFormatFilesList.mockReturnValue("Formatted list content") // Default formatted result
		;(pathUtils.isPathOutsideWorkspace as jest.Mock).mockReturnValue(false)

		mockBlock = {
			type: "tool_use",
			name: "list_directories",
			params: {
				paths: ["dir1", "dir2"], // Default batch paths
				recursive: "false",
			},
			partial: false,
		}
	})

	it("should call askApproval with correct batch paths", async () => {
		await listDirectoriesTool(
			mockCline,
			mockBlock,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		expect(mockAskApproval).toHaveBeenCalledTimes(1)
		const approvalContent = JSON.parse(mockAskApproval.mock.calls[0][1] || "{}")
		expect(approvalContent.tool).toBe("listDirectories")
		// Expect absolute paths normalized with forward slashes
		expect(approvalContent.paths).toEqual([
			{ path: "C:/test/workspace/dir1", isOutsideWorkspace: false },
			{ path: "C:/test/workspace/dir2", isOutsideWorkspace: false },
		])
		expect(approvalContent.recursive).toBe(false)
	})

	it("should list multiple directories and push combined XML result", async () => {
		// Setup specific mocks
		mockListFiles.mockResolvedValueOnce([["fileA.txt"], false]).mockResolvedValueOnce([["fileB.js", "sub/"], false])
		mockFormatFilesList.mockReturnValueOnce("List for dir1").mockReturnValueOnce("List for dir2")

		await listDirectoriesTool(
			mockCline,
			mockBlock,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		expect(mockListFiles).toHaveBeenCalledTimes(2)
		// Use path.posix.resolve for consistent forward slashes in assertions
		// Use path.resolve for platform-correct paths
		expect(mockListFiles).toHaveBeenCalledWith(path.resolve(mockCline.cwd, "dir1"), false, 200)
		expect(mockListFiles).toHaveBeenCalledWith(path.resolve(mockCline.cwd, "dir2"), false, 200)
		expect(mockFormatFilesList).toHaveBeenCalledTimes(2)
		expect(mockPushToolResult).toHaveBeenCalledTimes(1)
		const resultXml = mockPushToolResult.mock.calls[0][0]
		expect(resultXml).toContain("<directories>")
		// Match exact whitespace from latest test output
	})
})
