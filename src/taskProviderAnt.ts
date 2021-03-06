
import {
    Task, TaskGroup, WorkspaceFolder, RelativePattern, ShellExecution, Uri,
    workspace, TaskProvider, TaskDefinition
} from "vscode";
import * as path from "path";
import * as util from "./util";
import { parseString } from "xml2js";
import { configuration } from "./common/configuration";
import { TaskItem } from "./tasks";
import { filesCache } from "./cache";
import { execSync } from "child_process";


interface StringMap { [s: string]: string; }
let cachedTasks: Task[];


interface AntTaskDefinition extends TaskDefinition
{
    script?: string;
    path?: string;
    fileName?: string;
    uri?: Uri;
    treeItem?: TaskItem;
}

export class AntTaskProvider implements TaskProvider
{
    constructor() {}

    public provideTasks() {
        return provideAntScripts();
    }

    public resolveTask(_task: Task): Task | undefined {
        return undefined;
    }
}


export async function invalidateTasksCacheAnt(opt?: Uri): Promise<void>
{
    util.log("");
    util.log("invalidateTasksCacheAnt");
    util.logValue("   uri", opt ? opt.path : (opt === null ? "null" : "undefined"), 2);
    util.logValue("   has cached tasks", cachedTasks ? "true" : "false", 2);

    if (opt && cachedTasks)
    {
        const rmvTasks: Task[] = [];

        await util.asyncForEach(cachedTasks, each => {
            const cstDef: AntTaskDefinition = each.definition;
            if (cstDef.uri.fsPath === opt.fsPath || !util.pathExists(cstDef.uri.fsPath)) {
                rmvTasks.push(each);
            }
        });

        //
        // Technically this function can be called back into when waiting for a promise
        // to return on the asncForEach() above, and cachedTask array can be set to undefined,
        // this is happening with a broken await() somewere that I cannot find
        if (cachedTasks)
        {
            await util.asyncForEach(rmvTasks, each => {
                util.log("   removing old task " + each.name);
                util.removeFromArray(cachedTasks, each);
            });

            //
            // If this isn"t a "delete file" event then read the file for tasks
            //
            if (util.pathExists(opt.fsPath) && !util.existsInArray(configuration.get("exclude"), opt.path))
            {
                const tasks = await readAntfile(opt);
                cachedTasks.push(...tasks);
            }

            if (cachedTasks.length > 0) {
                return;
            }
        }
    }

    cachedTasks = undefined;
}


async function detectAntScripts(): Promise<Task[]>
{
    util.log("");
    util.log("detectAntScripts");

    const allTasks: Task[] = [];
    const visitedFiles: Set<string> = new Set();
    const paths = filesCache.get("ant");

    if (workspace.workspaceFolders && paths)
    {
        for (const fobj of paths)
        {
            if (!util.isExcluded(fobj.uri.path) && !visitedFiles.has(fobj.uri.fsPath)) {
                visitedFiles.add(fobj.uri.fsPath);
                const tasks = await readAntfile(fobj.uri);
                allTasks.push(...tasks);
            }
        }
    }

    util.logValue("   # of tasks", allTasks.length, 2);
    return allTasks;
}


export async function provideAntScripts(): Promise<Task[]>
{
    util.log("");
    util.log("provideAntScripts");

    if (!cachedTasks) {
        cachedTasks = await detectAntScripts();
    }
    return cachedTasks;
}


async function readAntfile(uri: Uri): Promise<Task[]>
{
    const result: Task[] = [];
    const folder = workspace.getWorkspaceFolder(uri);

    if (folder)
    {
        const scripts = await findAllAntScripts(uri.fsPath);
        if (scripts)
        {
            Object.keys(scripts).forEach(each => {
                const task = createAntTask(scripts[`${each}`] ? scripts[`${each}`] : `${each}`, each, folder!, uri);
                task.group = TaskGroup.Build;
                result.push(task);
            });
        }
    }

    return result;
}


async function findAllAntScripts(path: string): Promise<StringMap>
{
    let text: any = "";
    const scripts: StringMap = {};
    const buffer = await util.readFile(path);

    util.log("");
    util.log("FindAllAntScripts");

    //
    // Try running 'ant' itself to get the targets.  If fail, just custom parse
    //
    // Sample Output of ant -p :
    //
    //     Buildfile: C:\Projects\.....\build.xml
    //
    //     Main targets:
    //
    //     Other targets:
    //
    //      Clean
    //      G32ProductionSQLServer
    //      G32SQLServer
    //      G64
    //      G64AspNetCore
    //      G64Production
    //      G64ProductionSQLServer
    //      G64SQLServer
    //      init
    //
    //     Default target: G64
    //

    let stdout: Buffer;
    if (configuration.get("useAnt") === true)
    {
        try {
            stdout = execSync(getCommand() + " -f " + path + " -p");
        }
        catch {}
    }

    if (stdout)
    {
        text = stdout.toString();
        //
        // First get the default, use 2nd capturing group (returned arr-idx 2):
        //
        let defaultTask = text.match(/(Default target: )([\w\-]+)/i);
        if (defaultTask && defaultTask.length > 2) {
            defaultTask = defaultTask[2];
            defaultTask = defaultTask.trim();
        }
        //
        // Loop through all the lines and extract the task names, if it's a task
        //
        text = text.split("\n");
        for (const i in text)
        {
            const line: string = text[i].trim();
            if (!line || line.match(/(target[s]{0,1}:|Buildfile:)/i)) {
                continue;
            }
            util.logValue("   Found target (ant -p)", line);
            scripts[defaultTask === line ? line + " - Default" : line] = line;
        }
    }
    else
    {
        parseString(buffer, (err, result) => {
            text = result;
        });

        if (text && text.project && text.project.target)
        {
            const defaultTask = text.project.$.default;
            const targets = text.project.target;
            for (const tgt in targets)
            {
                if (targets[tgt].$ && targets[tgt].$.name) {
                    util.logValue("   Found target (cst.)", targets[tgt].$.name);
                    scripts[defaultTask === targets[tgt].$.name ? targets[tgt].$.name + " - Default" : targets[tgt].$.name] = targets[tgt].$.name;
                }
            }
        }
    }

    return scripts;
}


function getCommand(): string
{
    let ant = "ant";
    if (process.platform === "win32") {
        ant = "ant.bat";
    }
    if (configuration.get("pathToAnt"))
    {
        ant = configuration.get("pathToAnt");
        if (process.platform === "win32" && ant.endsWith("\\ant")) {
            ant += ".bat";
        }
    }
    return ant;
}


function createAntTask(target: string, cmdName: string, folder: WorkspaceFolder, uri: Uri): Task
{
    function getRelativePath(folder: WorkspaceFolder, uri: Uri): string
    {
        if (folder) {
            const rootUri = folder.uri;
            const absolutePath = uri.path.substring(0, uri.path.lastIndexOf("/") + 1);
            return absolutePath.substring(rootUri.path.length + 1);
        }
        return "";
    }

    const cwd = path.dirname(uri.fsPath);
    const antFile = path.basename(uri.path);
    let args = [ target ];

    let options: any = {
        cwd
    };

    const kind: AntTaskDefinition = {
        type: "ant",
        script: target,
        path: getRelativePath(folder, uri),
        fileName: antFile,
        uri
    };

    //
    // Ansicon for Windows
    //
    if (process.platform === "win32" && configuration.get("enableAnsiconForAnt") === true)
    {
        let ansicon = "ansicon.exe";
        const ansiPath: string = configuration.get("pathToAnsicon");
        if (ansiPath && util.pathExists(ansiPath)) {
            ansicon = ansiPath;
            if (!ansicon.endsWith("ansicon.exe") && !ansicon.endsWith("\\")) {
                ansicon = path.join(ansicon, "ansicon.exe");
            }
            else if (!ansicon.endsWith("ansicon.exe")) {
                ansicon += "ansicon.exe";
            }
        }

        args = [ "-logger", "org.apache.tools.ant.listener.AnsiColorLogger", target ];
        options = {
            cwd,
            executable: ansicon
        };
    }

    if (antFile.toLowerCase() !== "build.xml")
    {
        args.push("-f");
        args.push(antFile);
    }

    const execution = new ShellExecution(getCommand(), args, options);

    return new Task(kind, folder, cmdName ? cmdName : target, "ant", execution, undefined);
}
