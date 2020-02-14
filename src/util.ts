
import {
    workspace, RelativePattern, WorkspaceFolder, OutputChannel, ExtensionContext, 
    commands, window
} from "vscode";
import * as fs from "fs";
import * as minimatch from "minimatch";
import { configuration } from "./common/configuration";


const logValueWhiteSpace = 40;
let writeToConsole = false;
let writeToConsoleLevel = 2;
let logOutputChannel: OutputChannel | undefined;


export async function asyncForEach(array: any, callback: any)
{
    for (let index = 0; index < array.length; index++) {
      await callback(array[index], index, array);
    }
}


export function initLog(context: ExtensionContext)
{
    // Set up a log in the Output window
    //
    logOutputChannel = window.createOutputChannel("Task Explorer");
    context.subscriptions.push(logOutputChannel);
    context.subscriptions.push(commands.registerCommand("taskExplorer.showOutput", () => logOutputChannel.show()));
    const showOutput = configuration.get<boolean>("showOutput");
    if (showOutput) {
        logOutputChannel.show();
    }
}


export function camelCase(name: string, indexUpper: number)
{
    if (!name) {
      return name;
    }

    return name
        .replace(/(?:^\w|[A-Za-z]|\b\w)/g, (letter, index) => {
            return index !== indexUpper ? letter.toLowerCase() : letter.toUpperCase();
        })
        .replace(/[\s\-]+/g, "");
}


export function properCase(name: string)
{
    if (!name) {
      return name;
    }

    return name
        .replace(/(?:^\w|[A-Z]|\b\w)/g, (letter, index) => {
            return index !== 0 ? letter.toLowerCase() : letter.toUpperCase();
        })
        .replace(/[\s]+/g, "");
}


export function getExcludesGlob(folder: string | WorkspaceFolder) : RelativePattern
{
    let relativePattern = new RelativePattern(folder, "**/node_modules/**");
    const excludes: string[] = configuration.get("exclude");

    if (excludes && excludes.length > 0) {
        let multiFilePattern = "{**/node_modules/**";
        if (Array.isArray(excludes))
        {
            for (const i in excludes) {
                multiFilePattern += ",";
                multiFilePattern += excludes[i];
            }
        }
        else {
            multiFilePattern += ",";
            multiFilePattern += excludes;
        }
        multiFilePattern += "}";
        relativePattern = new RelativePattern(folder, multiFilePattern);
    }

    return relativePattern;
}


export function isExcluded(uriPath: string, logPad = "")
{
    function testForExclusionPattern(path: string, pattern: string): boolean
    {
        return minimatch(path, pattern, { dot: true, nocase: true });
    }

    const exclude = configuration.get<string | string[]>("exclude");

    this.log("", 2);
    this.log(logPad + "Check exclusion", 2);
    this.logValue(logPad + "   path", uriPath, 2);

    if (exclude)
    {
        if (Array.isArray(exclude))
        {
            for (const pattern of exclude) {
                this.logValue(logPad + "   checking pattern", pattern, 3);
                if (testForExclusionPattern(uriPath, pattern)) {
                    this.log(logPad + "   Excluded!", 2);
                    return true;
                }
            }
        }
        else {
            this.logValue(logPad + "   checking pattern", exclude, 3);
            if (testForExclusionPattern(uriPath, exclude)) {
              this.log(logPad + "   Excluded!", 2);
              return true;
            }
        }
    }

    this.log(logPad + "   Not excluded", 2);
    return false;
}


export function timeout(ms: number)
{
    // tslint:disable-next-line: ban
    return new Promise(resolve => setTimeout(resolve, ms));
}


export function pathExists(path: string)
{
    try {
        fs.accessSync(path);
    } catch (err) {
        return false;
    }
    return true;
}


export async function readFile(file: string): Promise<string>
{
    return new Promise<string>((resolve, reject) => {
        fs.readFile(file, (err, data) => {
            if (err) {
                reject(err);
            }
            resolve(data.toString());
        });
    });
}


export function readFileSync(file: string)
{
    return fs.readFileSync(file).toString();
}


export function removeFromArray(arr: any[], item: any)
{
    let idx = -1;
    let idx2 = -1;

    arr.forEach(each => {
        idx++;
        if (item === each) {
            idx2 = idx;
            return false;
        }
    });

    if (idx2 !== -1 && idx2 < arr.length) {
        arr.splice(idx2, 1);
    }
}


export function existsInArray(arr: any[], item: any)
{
    let exists = false;
    if (arr) {
        arr.forEach(each => {
            if (item === each) {
                exists = true;
                return false;
            }
        });
    }

    return exists;
}


export function setWriteToConsole(set: boolean, level = 2)
{
    writeToConsole = set;
    writeToConsoleLevel = level;
}


export async function log(msg: string, level?: number)
{
    if (msg === null || msg === undefined) {
        return;
    }

    if (workspace.getConfiguration("taskExplorer").get("debug") === true)
    {
        if (!level || level <= configuration.get<number>("debugLevel")) {
            logOutputChannel.appendLine(msg);
        }
        if (writeToConsole === true) {
            if (!level || level <= writeToConsoleLevel) {
                console.log(msg);
            }
        }
    }
}


export async function logValue(msg: string, value: any, level?: number)
{
    let logMsg = msg;

    for (let i = msg && msg.length ? msg.length : (value === undefined ? 9 : 4); i < logValueWhiteSpace; i++) {
        logMsg += " ";
    }

    if (value || value === 0 || value === "") {
        logMsg += ": ";
        logMsg += value.toString();
    }
    else if (value === undefined) {
        logMsg += ": undefined";
    }
    else if (value === null) {
        logMsg += ": null";
    }

    if (workspace.getConfiguration("taskExplorer").get("debug") === true) {
        if (!level || level <= configuration.get<number>("debugLevel")) {
            logOutputChannel.appendLine(logMsg);
        }
        if (writeToConsole === true) {
            if (!level || level <= writeToConsoleLevel) {
                console.log(logMsg);
            }
        }
    }
}
