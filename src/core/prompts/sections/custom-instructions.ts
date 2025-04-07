import fs from "fs/promises"
import path from "path"

import { LANGUAGES, isLanguage } from "../../../shared/language"

async function safeReadFile(filePath: string): Promise<string> {
	try {
		const content = await fs.readFile(filePath, "utf-8")
		return content.trim()
	} catch (err) {
		const errorCode = (err as NodeJS.ErrnoException).code
		if (!errorCode || !["ENOENT", "EISDIR"].includes(errorCode)) {
			throw err
		}
		return ""
	}
}

export async function loadRuleFiles(cwd: string): Promise<string> {
	const ruleFiles = [".clinerules", ".cursorrules", ".windsurfrules"]
	let combinedRules = ""

	for (const file of ruleFiles) {
		const content = await safeReadFile(path.join(cwd, file))
		if (content) {
			combinedRules += `\n# Rules from ${file}:\n${content}\n`
		}
	}

	return combinedRules
}

export interface CustomInstructionsComponents {
	languagePreference: string
	globalInstructions: string
	modeSpecificInstructions: string
	rulesModeSpecific: string
	rulesGeneric: string
	rulesRooIgnore: string
	rulesAll: string
	fullSection: string
}

export async function addCustomInstructions(
	modeCustomInstructions: string,
	globalCustomInstructions: string,
	cwd: string,
	mode: string,
	options: { language?: string; rooIgnoreInstructions?: string } = {},
): Promise<CustomInstructionsComponents> {
	const sections: string[] = []
	const rules: string[] = []

	// --- Prepare Individual Components ---

	// Language Preference
	const languagePreference = options.language
		? `Language Preference:\nYou should always speak and think in the "${
				isLanguage(options.language) ? LANGUAGES[options.language] : options.language
			}" (${options.language}) language unless the user gives you instructions below to do otherwise.`
		: ""
	if (languagePreference) sections.push(languagePreference)

	// Global Instructions
	const globalInstructions =
		typeof globalCustomInstructions === "string" && globalCustomInstructions.trim()
			? `Global Instructions:\n${globalCustomInstructions.trim()}`
			: ""
	if (globalInstructions) sections.push(globalInstructions)

	// Mode-Specific Instructions
	const modeSpecificInstructions =
		typeof modeCustomInstructions === "string" && modeCustomInstructions.trim()
			? `Mode-specific Instructions:\n${modeCustomInstructions.trim()}`
			: ""
	if (modeSpecificInstructions) sections.push(modeSpecificInstructions)

	// Mode-Specific Rules
	let rulesModeSpecific = ""
	if (mode) {
		const modeRuleFile = `.clinerules-${mode}`
		const modeRuleContent = await safeReadFile(path.join(cwd, modeRuleFile))
		if (modeRuleContent && modeRuleContent.trim()) {
			rulesModeSpecific = `# Rules from ${modeRuleFile}:\n${modeRuleContent}`
			rules.push(rulesModeSpecific)
		}
	}

	// RooIgnore Rules
	const rulesRooIgnore = options.rooIgnoreInstructions || ""
	if (rulesRooIgnore) rules.push(rulesRooIgnore)

	// Generic Rules
	const genericRuleContent = await loadRuleFiles(cwd)
	const rulesGeneric = genericRuleContent && genericRuleContent.trim() ? genericRuleContent.trim() : ""
	if (rulesGeneric) rules.push(rulesGeneric)

	// Combined Rules Section
	const rulesAll = rules.length > 0 ? `Rules:\n\n${rules.join("\n\n")}` : ""
	if (rulesAll) sections.push(rulesAll)

	// --- Prepare Full Section ---
	const joinedSections = sections.join("\n\n")
	const fullSection = joinedSections
		? `
====

USER'S CUSTOM INSTRUCTIONS

The following additional instructions are provided by the user, and should be followed to the best of your ability without interfering with the TOOL USE guidelines.

${joinedSections}`
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
}
