import defaultShell from "default-shell"
import * as os from "os" // Use namespace import
import osName from "os-name"
import { Mode, ModeConfig, getModeBySlug, defaultModeSlug, isToolAllowedForMode } from "../../../shared/modes"
import { getShell } from "../../../utils/shell"

export interface SystemInfoComponents {
	os: string
	shell: string
	homeDir: string
	cwd: string
	envDetailsExplanation: string
	fullSection: string
}
export function getSystemInfoSection(cwd: string): SystemInfoComponents {
	const osNameStr = `Operating System: ${osName()}` // Renamed variable
	const shell = `Default Shell: ${getShell()}`
	const homeDir = `Home Directory: ${os.homedir()}` // Use imported os module
	const currentWorkingDir = `Current Working Directory: ${cwd.toPosix()}`
	const envDetailsExplanation = `When the user initially gives you a task, a recursive list of all filepaths in the current working directory ('/test/path') will be included in environment_details. This provides an overview of the project's file structure, offering key insights into the project from directory/file names (how developers conceptualize and organize their code) and file extensions (the language used). This can also guide decision-making on which files to explore further. If you need to further explore directories such as outside the current working directory, you can use the list_files tool. If you pass 'true' for the recursive parameter, it will list files recursively. Otherwise, it will list files at the top level, which is better suited for generic directories where you don't necessarily need the nested structure, like the Desktop.`

	const fullSection = `====

SYSTEM INFORMATION

${osNameStr}
${shell}
${homeDir}
${currentWorkingDir}

${envDetailsExplanation}`

	return {
		os: osNameStr,
		shell,
		homeDir: homeDir, // Renamed variable to avoid conflict
		cwd: currentWorkingDir, // Renamed variable to avoid conflict
		envDetailsExplanation,
		fullSection,
	}
}
