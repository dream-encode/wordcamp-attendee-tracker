import pluginJs from "@eslint/js"
import globals from "globals"

/*
 * House style, matching url-server-health-monitoring: ESM, no semicolons, padded
 * parens, tabs. `recommended` goes first so the explicit rules below win.
 */
const houseStyle = {
	rules: {
		semi: [ "error", "never" ],
		"space-in-parens": [ "error", "always" ],
		"prefer-const": "error",
		curly: [ "error", "all" ],
		"padding-line-between-statements": [
			"error",
			{ blankLine: "always", prev: "*", next: "return" }
		],
		"multiline-comment-style": [ "error", "starred-block" ]
	}
}

/** @type {import('eslint').Linter.Config[]} */
export default [
	/*
	 * .wrangler holds the bundles `wrangler dev` generates. Flat config does not read
	 * .gitignore, so without this line linting after a Worker dev session reports hundreds
	 * of style errors in machine-generated code.
	 */
	{ ignores: [ "node_modules/**", "**/.wrangler/**", "site/data/**", "tests/fixtures/**" ] },
	pluginJs.configs.recommended,
	houseStyle,
	{
		files: [ "scripts/**/*.js", "tests/**/*.js", "eslint.config.js" ],
		languageOptions: { globals: globals.node }
	},
	{
		files: [ "site/**/*.js" ],
		languageOptions: { globals: globals.browser }
	},
	{
		files: [ "worker/**/*.js" ],
		languageOptions: { globals: { ...globals.worker, ...globals.browser } }
	}
]
