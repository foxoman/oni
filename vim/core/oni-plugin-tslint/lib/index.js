const Q = require("q")
const path = require("path")
const os = require("os")
const exec = require("child_process").exec

const findParentDir = require("find-parent-dir")

const tslintPath = path.join(__dirname, "..", "..", "..", "..", "node_modules", "tslint", "lib", "tslint-cli.js")

let lastErrors = {}
let lastArgs = null

const activate = (Oni) => {

    const doLintForFile = (args) => {
        if (!args.bufferFullPath) {
            return
        }

        const currentWorkingDirectory = getCurrentWorkingDirectory(args)
        const tslint = getLintConfig(currentWorkingDirectory)

        if (!tslint) {
            console.warn("No tslint.json found; not running tslint.")
            return
        }

        executeTsLint(tslint, [args.bufferFullPath], currentWorkingDirectory)
            .then((errors) => {
                Object.keys(errors).forEach(f => {
                    Oni.diagnostics.setErrors("tslint-ts", f, errors[f], "yellow")
                })

                if (!errors[args.bufferFullPath]) {
                    Oni.diagnostics.setErrors("tslint-ts", args.bufferFullPath, [], "yellow")
                    lastErrors[args.bufferFullPath] = null
                }
            })
    }

    const doLintForProject = (args, autoFix) => {
        if (!args.bufferFullPath) {
            return
        }

        lastArgs = args

        const currentWorkingDirectory = getCurrentWorkingDirectory(args)
        const tslint = getLintConfig(currentWorkingDirectory)

        if (!tslint) {
            console.warn("No tslint.json found; not running tslint.")
            return
        }

        const project = findParentDir.sync(currentWorkingDirectory, "tsconfig.json")
        let processArgs = []

        if (project) {
            processArgs.push("--project", path.join(project, "tsconfig.json"))
        } else {
            processArgs.push(arg.bufferFullPath)
        }

        executeTsLint(tslint, processArgs, currentWorkingDirectory, autoFix)
            .then((errors) => {
                // Send all updated errors
                Object.keys(errors).forEach(f => {
                    Oni.diagnostics.setErrors("tslint-ts", f, errors[f], "yellow")
                })

                // Send all errors that were cleared
                Object.keys(lastErrors).forEach(f => {
                    if (lastErrors[f] && !errors[f]) {
                        Oni.diagnostics.setErrors("tslint-ts", f, [], "yellow")
                    }
                })

                lastErrors = errors
            })
    }

    Oni.on("buffer-saved", doLintForFile)
    Oni.on("buffer-enter", doLintForProject)

    Oni.commands.registerCommand("tslint.fix", (args) => {
        doLintForProject(lastArgs, true)
    })

    function executeTsLint(configPath, args, workingDirectory, autoFix) {

        let processArgs = []

        if (autoFix) {
            processArgs = processArgs.concat(["--fix"])
        }

        processArgs = processArgs.concat(["--force", "--format", "json"])

        processArgs = processArgs.concat(["--config", path.join(configPath, "tslint.json")])
        processArgs = processArgs.concat(args)

        return Q.nfcall(Oni.execNodeScript, tslintPath, processArgs, { cwd: workingDirectory })
            .then((stdout, stderr) => {

                const errorOutput = stdout.join(os.EOL).trim()

                const lintErrors = JSON.parse(errorOutput)

                const errorsWithFileName = lintErrors.map(e => ({
                    type: null,
                    file: path.normalize(e.name),
                    text: `[${e.ruleName}] ${e.failure}`,
                    lineNumber: e.startPosition.line,
                    startColumn: e.startPosition.character,
                    endColumn: e.endPosition.character,
                }))

                const errors = errorsWithFileName.reduce((prev, curr) => {
                    prev[curr.file] = prev[curr.file] || []

                    prev[curr.file].push({
                        type: curr.type,
                        text: curr.text,
                        lineNumber: curr.lineNumber + 1,
                        startColumn: curr.startColumn + 1,
                        endColumn: curr.endColumn
                    })

                    return prev
                }, {})

                return errors
            }, (err) => console.error(err))
    }

    function getCurrentWorkingDirectory(args) {
        return path.dirname(args.bufferFullPath)
    }

    function getLintConfig(workingDirectory) {
        return findParentDir.sync(workingDirectory, "tslint.json")
    }
}

module.exports = {
    activate
}
