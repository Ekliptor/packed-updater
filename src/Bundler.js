"use strict";

const path = require('path')
    //, tar = require('tar-fs')
    , tar = require('./libs/tarfs')
    //tar = require('tar') // doesn't support strict mode yet
    //, fstream = require('fstream') // needed for tar
    , fs = require('fs-extra')
    , zlib = require('zlib')
    , helper = require('./utils/helper')
    , updaterJson = require('../models/updaterJson')
    , NodeModule = require('../models/NodeModule')

const MODULE_DIR = 'node_modules' + path.sep
const TEMP_DIR_BASE = '..' + path.sep + 'temp-'// has to be OUTSIDE of app dir
const MIN_FILES_INSTALLED_NODE_MODULES = 1 // browserutils has 2, mitm-local has 1

let logger = console

class Bundler {
    // TODO private packages are not included if they are only a depdency of a sub project (root project must have them as a dependency)
    // TODO don't bundle modules from workspaces. currently they get bundled twice (in workspace and node_modules dir). bug only with private modules
    // TODO file path stacktraces are 1 directory too high after we remove the build dir. bundle the original TS source with it? or keep the parent dir empty?
    constructor(packageJson) {
        this.json = packageJson
        this.workspaces = []; // array of absolute path to workspaces of root project
        this.workspaceProjects = new Map() // (workspace path, projects as array)

        this.compilerJson = null; // tsconfig object
        this.compiledOutputDir = ""; // the output dir of the source project
        this.compilerOutDirDest = ""; // the output dir of the temp bundle location we create (to be deleted)
        this.addSourceMaps = true;
        this.bundleTypescript = false; // if true, bundle .ts files directly instead of compiled .js files
        this.ignorePaths = [];
        this.ignoreExtensions = [];
        this.ensureWorspaceModulesInstalled = true;
        this.moduleConfig = null; // Map (configFilePath, json)
    }

    static setLogger(loggerObj) {
        logger = loggerObj
    }

    static readJson(jsonPath, callback) {
        fs.readFile(jsonPath, 'utf8', (err, data) => {
            if (err)
                return callback(err)
            if (!data || data.length === 0 || data[0] !== '{')
                return callback({text: 'Invalid .json file', location: jsonPath})
            let json = helper.parseJson(data)
            if (json === null)
                return callback({text: 'Error parsing .json file', location: jsonPath})
            callback(null, json)
        })
    }

    /**
     * Create the bundle.
     * Pro tip: to fix inconsistencies with npm install, set dependencies to private to force shipping the working ones with this updater
     * (if enforceModuleVersions isn't working)
     * @param dependencies
     * @param options
     * @returns {Promise}
     */
    bundle(dependencies, options) {
        // only works when all packages to be bundled are installed locally (npm install run inside their directory)
        // so we have to create some duplicates if we force packages to be private.
        // TODO better walk up the parent chain in here...

        if (typeof options.addSourceMaps === "boolean")
            this.addSourceMaps = options.addSourceMaps;
        if (typeof options.bundleTypescript === "boolean")
            this.bundleTypescript = options.bundleTypescript;
        if (options.ignorePaths)
            this.ignorePaths = options.ignorePaths;
        if (typeof options.ensureWorspaceModulesInstalled === "boolean")
            this.ensureWorspaceModulesInstalled = options.ensureWorspaceModulesInstalled;

        return new Promise((resolve, reject) => {
            let modulePaths = null
            let copyDest = path.join(options.srcPath, TEMP_DIR_BASE + helper.getRandomString(6) + path.sep)
            let version = options.addVersion ? '-' + this.json.version : ''
            let bundleDest = path.join(options.bundleDestDir, this.json.name + version + '.tar.gz')

            this.loadWorkspaces(options.srcPath).then(() => {
                return this.getCompiledOutputDir(options.srcPath)
            }).then((outPath) => {
                this.compiledOutputDir = outPath
                //bundleDest = this.getBundleDest(options) // call this after we set a compile output dir
                return this.findPrivateModules(dependencies, options.srcPath)
            }).then((modules) => {
                modulePaths = this.flattenModules(modules)
                return this.getModuleConfig(modulePaths)
            }).then((moduleConfig) => {
                this.moduleConfig = moduleConfig
                return this.createBundleTempFolder(copyDest)
            }).then(() => {
                logger.log('Updater: Copying source...')
                return this.copySource(options.srcPath, dependencies, modulePaths, copyDest)
            }).then(() => {
                return this.copyModulesToRoot(modulePaths, options.srcPath, copyDest)
            }).then(() => {
                return this.deleteSubModules(dependencies, copyDest, options)
            }).then(() => {
                return this.getModuleDestRootDirs(copyDest) // do this after writing all dependencies
            }).then((packageDirs) => {
                return this.modifyPackageJson(packageDirs, options.srcPath, copyDest)
            }).then(() => {
                return this.createOutputDir(bundleDest)
            }).then(() => {
                logger.log('Updater: Packing update...')
                return this.packTempResult(copyDest, bundleDest)
            }).then(() => {
                return this.deleteTempFolder(copyDest)
            }).then(() => {
                return this.createPackageJson(options, bundleDest)
            }).then((json) => {
                logger.log('Updater: Done packing')
                resolve({
                    dest: bundleDest,
                    jsonDest: json
                })
            }).catch((err) => {
                this.deleteTempFolder(copyDest)
                reject(err)
            })
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    packTempResult(copyDest, bundleDest) {
        return new Promise((resolve, reject) => {
            const gzip = zlib.createGzip()
            let packStream = tar.pack(copyDest, {
                dereference: false, // we already resolved symlinks when copying to temp
                ignore(name) {
                    return false
                    let filename = path.basename(name)
                    if (filename && filename[0] === '.')
                        return true
                    if (name.substr(-4) === '.log')
                        return true


                    // uncomment below for a simple version to get reproducable errors (same code on every machine)
                    // still run npm install to ensure you install binary dependencies
                    if (name.indexOf(rootModuleDir) !== -1) {
                        if (that.isInModules(rootModuleDir, modules, name) === false) {
                            // TODO move our own modules to root and add them only once
                            // but since we pack them, redundant code should't increase the archive size a lot
                            return true
                        }
                        const sepStr = '\\' + path.sep;
                        let tempRegex = new RegExp(sepStr + 'temp' + sepStr + '.+', 'i')
                        if (tempRegex.test(name) === true)
                            return true // don't pack temp files of our own modules (browser cache etc..)
                    }
                    return false
                },
                mapStream(fileStream, header) { // called before ignore()
                    /*if (path.extname(header.name) === '.js') {
                     return fileStream.pipe(someTransform) // TODO add optional closure compiler (and obfuscator?)
                     }
                     */
                    return fileStream
                }
            }).pipe(gzip).pipe(fs.createWriteStream(bundleDest))
            packStream.on('finish', resolve)
            packStream.on('error', reject)
        })
    }

    deleteSubModules(dependencies, copyDest, options) {
        return new Promise((resolve, reject) => {
            let rootModuleDir = path.join(copyDest, MODULE_DIR)
            fs.readdir(rootModuleDir, (err, files) => {
                if (err)
                    return reject(err)
                let removeOps = []
                files.forEach((curFile) => {
                    let subDir = path.join(rootModuleDir, curFile)
                    fs.readdir(subDir, (err, files) => {
                        if (err)
                            return reject(err)
                        files.forEach((subFile) => {
                            if (subFile === 'package.json') {
                                let jsonPath = path.join(subDir, 'package.json')
                                removeOps.push(this.removeDependencies(dependencies, jsonPath, options))
                                return
                            }
                            if (subFile !== 'node_modules')
                                return
                            removeOps.push(new Promise((resolve, reject) => {
                                fs.remove(path.join(subDir, subFile), (err) => {
                                    if (err)
                                        return reject(err)
                                    resolve()
                                })
                            }))
                        })
                    })
                })
                Promise.all(removeOps).then(() => {
                    setTimeout(() => { // all deletions are done. but our stream for packing still returns an error sometimes. wait for OS
                        resolve()
                    }, 1000)
                }).catch((err) => {
                    reject(err)
                })
            })
        })
    }

    removeDependencies(dependencies, jsonPath, options) {
        return new Promise((resolve, reject) => {
            fs.readFile(jsonPath, 'utf8', (err, data) => {
                if (err)
                    return reject(err)
                let json = helper.parseJson(data)
                if (json === null)
                    return reject({text: 'Error parsing package.json to delete: ' + jsonPath})
                dependencies.forEach((dep) => {
                    if (json[dep] && json.privateNoInstall !== true)
                        json[dep] = {} // they are now all dependancies of the root module
                    if (!options.enforceModuleVersions)
                        return
                    for (let modName in options.enforceModuleVersions) {
                        if (json[dep][modName]) {
                            let version = options.enforceModuleVersions[modName]
                            logger.debug('enforcing "%s" of "%s" to "%s"', modName, json.name, version)
                            json[dep][modName] = version
                        }
                    }
                })
                fs.writeFile(jsonPath, JSON.stringify(json, null, 4), 'utf8', (err) => {
                    if (err)
                        return reject(err)
                    resolve()
                })
            })
        })
    }

    copyModulesToRoot(modules, srcRoot, copyDest) {
        return new Promise((resolve, reject) => {
            let rootModuleDir = path.join(copyDest, MODULE_DIR)
            let copyOptions = {
                clobber: true, // overwrite
                dereference: true // will recursively resolve all symlinks (also dependencies of packets our root module depends on)
            }
            let copyOps = []
            modules.forEach((modPath) => {
                if (this.isWorkspaceModule(modPath) === true)
                    return; // workspace modules are already in on top level because they must be part of the workspace dir (usually "packages")
                modPath = modPath.replace(srcRoot, copyDest)
                // here we already filtered files. move all to the root (overwrite existing ones. we checked for module version conflicts)
                let destDir = path.join(rootModuleDir, NodeModule.getBaseFromPath(modPath))
                //let relativeModPath = modPath.substr(modPath.indexOf(MODULE_DIR) + MODULE_DIR.length)
                copyOps.push(new Promise((resolve, reject) => {
                    if (modPath === destDir)
                        return resolve() // happens with root modules
                    //console.log("copy to root from %s to %s", modPath, destDir)
                    fs.copy(modPath, destDir, copyOptions, (err) => {
                        if (err && err.code !== 'EEXIST') { // ENOENT
                            return reject({err: err, src: modPath, dest: destDir})
                        }
                        resolve()
                    })
                    //console.log("from: " + modPath)
                    //console.log("to: " + rootModuleDir)
                }))
            })
            Promise.all(copyOps).then(() => {
                resolve()
            }).catch((err) => {
                reject({txt: "Error copying modules to root", err: err})
            })
        })
    }

    copySource(srcRoot, dependencies, modules, copyDest) {
        return new Promise((resolve, reject) => {
            let rootModuleDir = path.join(srcRoot, MODULE_DIR)
            const rootProjectName = path.basename(this.json.name); // remove @author namespace
            const rootProjectBuildDirName = path.basename(this.compiledOutputDir);
            let that = this // fs-extra is not ES6 ready

            // we copy the root source dir of our app (with typescript files)
            // if we see files that need to be compiled we add them to that list (don't copy them)
            // then we copy the corresponding compiled files afterwards
            let copyCompiledFiles = []
            //let modifyJsonFiles = []

            let copyOptions = {
                dereference: true,
                filter(name) {
                    let filename = path.basename(name)
                    if (filename && filename[0] === '.')
                        return false
                    if (name.substr(-4) === '.log')
                        return false
                    if (that.isWorkspaceModule(name))
                        return false // all private modules must be in workspace. so they can't have any modules as dependencies that we need to copy
                    const extension = path.extname(name);
                    if (that.ignoreExtensions.indexOf(extension) !== -1)
                        return false

                    // check permissions: if file is not writable the updater will not be able to overwrite it after installing it once
                    // strange place here in options, but works
                    // stats.mode is filesystem and OS dependant
                    fs.access(name, fs.constants.R_OK | fs.constants.W_OK, (err) => {
                        if (err) {
                            logger.error("No read/write permissions on file: %s", name)
                            return reject({txt: "No read/write permissions on file", file: name})
                        }
                        // do nothing
                    });

                    // bundle .js files instead of typescript files (unless bundleTypescript is true)
                    if (that.compiledOutputDir && !that.bundleTypescript && name.substr(-3) === '.ts') {
                        if (name.substr(-5) === '.d.ts')
                            return false;
                        else if (that.isIgnorePath(name) === true)
                            return false;
                        let compiledFileSrc, compiledFileDest;
                        // fix for apputils (a module we use the compiled code)
                        /*
                        const utilsDir = path.sep + "apputils" + path.sep;
                        if (name.indexOf(utilsDir) !== -1) {
                            compiledFileSrc = name.replace(utilsDir, utilsDir + "build" + path.sep)
                            compiledFileSrc = compiledFileSrc.replace(/\.ts$/, '.js')
                        }
                        else {
                            compiledFileSrc = name.replace(srcRoot, that.compiledOutputDir).replace(/\.ts$/, '.js')
                        }
                        */
                        compiledFileSrc = name;
                        const compiledModuleDirs = that.getCompiledModuleDirs(modules, name);
                        compiledModuleDirs.forEach((mod) => {
                            let search = mod.getBasename().replace(/\\/g, "\\\\");
                            // replace "apputils" with "apputils/build"
                            compiledFileSrc = compiledFileSrc.replace(new RegExp(search, "g"), path.join(mod.getBasename(), mod.getBuildDir()) + path.sep)

                            // node_modules is always in project root dir
                            search = helper.escapeRegex(path.join(path.sep, mod.getBuildDir(), path.sep, "node_modules", path.sep))
                            compiledFileSrc = compiledFileSrc.replace(new RegExp(search, "g"), path.sep + "node_modules" + path.sep)
                        })
                        compiledFileSrc = path.normalize(compiledFileSrc.replace(srcRoot, that.compiledOutputDir).replace(/\.ts$/, '.js'))

                        // node_modules is always in project root dir
                        if (that.compilerJson) {
                            let rootModule = new NodeModule("", that.json, that.compilerJson)
                            let search = helper.escapeRegex(path.join(path.sep, rootModule.getBuildDir(), path.sep, "node_modules", path.sep))
                            compiledFileSrc = compiledFileSrc.replace(new RegExp(search, "g"), "/node_modules/")
                        }

                        compiledFileDest = path.join(copyDest, name.replace(srcRoot, '').replace(/\.ts$/, '.js'))
                        // monorepo builds are not compiled in root/build, but in their own project
                        // change paths from /SpiderManager/build/packages/chrome-browser/chrome.js
                        // to /SpiderManager/packages/chrome-browser/build/chrome.js ("build" dir 2 levels down)
                        that.workspaces.forEach((workspacePath) => {
                            const workspaceName = path.basename(workspacePath)
                            let buildDirSearch = path.join(rootProjectName, rootProjectBuildDirName, workspaceName)
                            if (compiledFileSrc.indexOf(buildDirSearch) !== -1) {
                                let searchStr = path.sep + path.join(rootProjectName, rootProjectBuildDirName, workspaceName, "([^\\" + path.sep + "]+)") + path.sep;
                                searchStr = searchStr.replace(/\\/g, "\\\\");
                                // TODO should be sub project buildDir (might differ from root)
                                const replaceStr = path.sep + path.join(rootProjectName, workspaceName, "$1", rootProjectBuildDirName) + path.sep;
                                compiledFileSrc = compiledFileSrc.replace(new RegExp(searchStr), replaceStr)
                            }
                        })
                        /*
                        if (compiledFileSrc.indexOf("/SpiderManager/build/packages/") !== -1) {
                            compiledFileSrc = compiledFileSrc.replace(new RegExp("/" + rootProjectName + "/build/packages/([^\/]+)/"), "/SpiderManager/packages/$1/build/")
                                //.replace("/SpiderManager/build/packages/", "/SpiderManager/packages/")
                        }
                        */
                        copyCompiledFiles.push({src: compiledFileSrc, dest: compiledFileDest})
                        if (that.addSourceMaps)
                            copyCompiledFiles.push({src: compiledFileSrc + '.map', dest: compiledFileDest + '.map'})
                        return false
                    }
                    // don't bundle locally compiled build dirs of sub modules (we copy them to the root dir)
                    // skip this check when bundleTypescript is true (we want source files from project root, not compiled output)
                    if (that.compiledOutputDir && !that.bundleTypescript) { // TODO this will not work if our modules use another folder name for their "build" dir
                        let folderName = path.sep + that.getCompileFolderName() + path.sep; // last sep is important or else we skip build.js files
                        if (name.indexOf(folderName) !== -1)
                            return false;
                    }

                    if (name.indexOf(rootModuleDir) !== -1) {
                        if (that.isInModules(rootModuleDir, modules, name) === false)
                            return false
                        const sepStr = '\\' + path.sep;
                        let tempRegex = new RegExp(sepStr + 'temp' + sepStr + '.+', 'i')
                        if (tempRegex.test(name) === true)
                            return false // don't pack temp files of our own modules (browser cache etc..)
                    }

                    // check if it's an ignored directory or file
                    if (that.isIgnorePath(name) === true)
                        return false;

                    //if (filename === "package.json") // these are file paths before copying
                        //modifyJsonFiles.push(name)
                    return true
                }
            }
            fs.copy(srcRoot, copyDest, copyOptions, (err) => {
                if (err)
                    return reject({txt: "Error copying files to temp dir", err: err})
                let copyOps = [] // has do be done AFTER copy() or else we will get fs errors
                copyCompiledFiles.forEach((compiledFile) => {
                    copyOps.push(that.copySingleFile(compiledFile.src, compiledFile.dest))
                })
                Promise.all(copyOps).then(() => {
                    return this.deleteCompiledDir(srcRoot, copyDest) // before copying dependencies
                }).then(() => {
                    return this.copyDependenciesToRootJson(dependencies, modules, copyDest)
                }).then(() => {
                    return this.writeDependencies(copyDest, modules)
                }).then(() => {
                    resolve()
                }).catch((err) => {
                    reject({txt: "Error copying module files", err: err})
                })
            })
        })
    }

    writeDependencies(copyDest, modules) {
        return new Promise((resolve, reject) => {
            let writeOps = []
            writeOps.push(new Promise((resolve, reject) => {
                fs.writeFile(path.join(copyDest, 'package.json'), JSON.stringify(this.json, null, 4), 'utf8', (err) => {
                    if (err)
                        return reject(err)
                    resolve()
                })
            }))
            Promise.all(writeOps).then(() => {
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    copyDependenciesToRootJson(dependencies, modules, srcRoot) {
        let updates = []
        return new Promise((resolve, reject) => {
            modules.forEach((modPath) => {
                let jsonPath = path.join(modPath, 'package.json')
                updates.push(new Promise((resolve, reject) => {
                    fs.readFile(jsonPath, 'utf8', (err, data) => {
                        if (err)
                            return reject(err)
                        let json = helper.parseJson(data)
                        if (json === null)
                            return reject({text: 'Error parsing package.json: ' + jsonPath})
                        dependencies.forEach((dep) => {
                            if (typeof json[dep] !== 'object')
                                return // no dependencies to copy for this module
                            if (!this.json[dep])
                                this.json[dep] = {}
                            let moduleDepNames = Object.keys(json[dep])
                            moduleDepNames.forEach((depName) => {
                                if (!this.json[dep][depName])
                                    this.json[dep][depName] = json[dep][depName] // copy it
                                else if (this.json[dep][depName] !== json[dep][depName]) {
                                    return reject({ // TODO real version number interpreting?
                                        text: 'possibly conflicting dependencies. Check "' + depName + '" in ' + jsonPath,
                                        modules: modules,
                                        version1: this.json[dep][depName],
                                        version2: json[dep][depName]
                                    })
                                }
                                // else nothing to do
                            })
                            resolve()
                        })
                    })
                }))
            })
            Promise.all(updates).then(() => {
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    flattenModules(modules) {
        // since npmv3 all module dependencies are flattened (installed in root node_modules folder)
        // with private modules and symlinks we can still have nested dependencies.
        // find them and install every module once in the root folder
        let uniqueNames = new Set()
        let uniqueModules = []
        modules.forEach((modPath) => {
            let modName = NodeModule.getBaseFromPath(modPath)
            if (uniqueNames.has(modName))
                return
            uniqueNames.add(modName)
            uniqueModules.push(modPath) // TODO is the first one really always the one from the root? should be, see findPrivateModules()
        })
        return uniqueModules
    }

    isInModules(rootModuleDir, modules, filename) {
        let folderPos = filename.lastIndexOf(MODULE_DIR)
        if (folderPos === -1)
            return false
        folderPos = filename.indexOf(path.sep, folderPos) + 1
        let folderEndPos = filename.indexOf(path.sep, folderPos + 1)
        if (folderEndPos === -1)
            folderEndPos = Number.MAX_VALUE
        // get the name beginning from the deepest module until the next /
        let folder = filename.substring(folderPos, folderEndPos)
        //let fileNameWithoutRoot = filename.substr(rootModuleDir.length)
        for (let modPath of modules)
        {
            let modName = path.basename(modPath)
            if (modName === folder)
                return true
            const modPathStart = modPath.substr(0, filename.length)
            // TODO better recursion than calling dirname(). go up the directory until we hit a node_modules dir
            if (modPathStart === filename || modPathStart === path.dirname(filename) || modPathStart === path.dirname(path.dirname(filename))) {
                const modPathEnd = modPath.substr(filename.length+1)
                //if (modPathEnd.indexOf(path.sep) === -1)
                if (modPathEnd.indexOf(MODULE_DIR) === -1)
                    return true
            }
            //else if (helper.substrCount(filename, MODULE_DIR) <= 1)
                //return true // only 1 node_modules dir. just include it (should be ok)
            //else if (filename.indexOf("apputils") !== -1 || filename.indexOf("base") !== -1)
                //console.log(filename)
        }
        return false
    }

    isInWantedModule(modules, filename) {
        for (let curModule of modules)
        {
            if (filename.substr(0, curModule.length) === curModule)
                return true
        }
        return false
    }

    isSubModule(filename) {
        return helper.substrCount(filename, MODULE_DIR) > 1
    }

    findPrivateModules(dependencies, srcRoot) {
        return new Promise((resolve, reject) => {
            let modules = []
            let packageModules = []
            let jsonPath = path.join(srcRoot, 'package.json')
            fs.readFile(jsonPath, 'utf8', (err, data) => {
                if (err)
                    return reject(err)
                let json = helper.parseJson(data)
                if (json === null)
                    return reject({text: 'Error parsing module json: ' + jsonPath})
                let moduleOps = []
                dependencies.forEach((dep) => {
                    if (json[dep] === undefined)
                        return
                    if (json.privateNoInstall === true)
                        return
                    let packageNames = Object.keys(json[dep])
                    moduleOps.push(this.loadModules(packageNames, srcRoot))
                })
                Promise.all(moduleOps).then((packageModulesArr) => {
                    for (let curPathResult of packageModulesArr) {
                        if (curPathResult.length !== 0) // sub modules with no dependencies
                            packageModules = packageModules.concat(curPathResult)
                    }
                    let findRecursiveModules = []
                    packageModules.forEach((modulePath) => {
                        findRecursiveModules.push(this.findPrivateModules(dependencies, modulePath))
                    })
                    return Promise.all(findRecursiveModules) // recursively go down into dirs
                }).then((subPaths) =>{
                    modules = packageModules
                    if (subPaths.length !== 0) {
                        for (let curPathResult of subPaths)
                            modules = modules.concat(curPathResult) // the array from Promise.all() is already unpacked below
                    }
                    resolve(modules)
                }).catch((err) => {
                    reject(err)
                })
            })
        })
    }

    loadModules(packageNames, srcRoot) {
        return new Promise((resolve, reject) => {
            let modules = []
            let moduleOps = []
            packageNames.forEach((pName) => {
                let moduleDir = path.join(srcRoot, MODULE_DIR, pName)
                moduleOps.push(new Promise((resolve, reject) => {
                    let jsonPath = path.join(moduleDir, 'package.json')
                    fs.readFile(jsonPath, 'utf8', (err, data) => {
                        if (err)
                            return reject(err)
                        let moduleJson = helper.parseJson(data)
                        if (moduleJson === null)
                            return reject({text: 'Error parsing module json: ' + jsonPath})
                        if (moduleJson.private === true || moduleJson.bundleUpdate === true)
                            resolve(moduleDir)
                        else
                            resolve(null) // not a private module
                    })
                }))
            })
            Promise.all(moduleOps).then((modulePathArr) => {
                modulePathArr.forEach((modulePath) => {
                    if (modulePath) // filter the modules we skiped (public)
                        modules.push(modulePath)
                })
                resolve(modules)
            }).catch((err) => {
                reject(err)
            })
        })
    }

    createOutputDir(bundleDest) {
        return new Promise((resolve, reject) => {
            let dir = path.dirname(bundleDest)
            fs.mkdirs(dir, (err) => {
                if (err)
                    return reject(err)
                resolve()
            })
        })
    }

    createPackageJson(options, bundleDest) {
        return new Promise((resolve, reject) => {
            let version = options.addVersion ? '-' + this.json.version : ''
            let jsonDest = path.join(options.bundleDestDir, this.json.name + version + '.json')
            let bundleName = path.basename(bundleDest)
            helper.hashFile(bundleDest).then((hash) => {
                let jsonData = new updaterJson.UpdaterJson(this.json.name, this.json.version, bundleName, hash)
                jsonData.bundleUrl = bundleName
                fs.writeFile(jsonDest, JSON.stringify(jsonData, null, 4), (err) => {
                    if (err)
                        return reject(err)
                    this.verifyHash(jsonDest, bundleDest).then(() => {
                        resolve(jsonDest)
                    }).catch((err) => {
                        reject(err)
                    })
                })
            })
        })
    }

    async verifyHash(jsonDestPath, bundleDest) {
        try { // we had hash mismatch before on valid updates with NodeJS v12. so better be sure before shipping. but might also be a failed upload
            let data = await fs.promises.readFile(jsonDestPath, {encoding: "utf8"})
            let bundle = helper.parseJson(data)
            if (bundle === null)
                throw new Error("Invalid JSON in created update bundle")
            let realHash = await helper.hashFile(bundleDest)
            if (realHash !== bundle.sha1)
                throw new Error("Hash mismatch on created update bundle: real=" + realHash + ", json=" + bundle.sha1)
        }
        catch (err) {
            throw new Error("Unable to verify bundle hash on creating update package: " + (err ? err.toString() : ""))
        }
    }

    deleteTempFolder(copyDest) {
        return new Promise((resolve, reject) => {
            fs.remove(copyDest, (err) => {
                if (err)
                    return resolve() // ignore it
                resolve()
            })
        })
    }

    copySingleFile(fileSrc, fileDest) {
        return new Promise((resolve, reject) => {
            fs.copy(fileSrc, fileDest, (err) => {
                if (err)
                    return reject({txt: 'error copying single file', dest: fileDest, err: err})
                resolve()
            })
        })
    }

    getCompiledOutputDir(srcDir) {
        return new Promise((resolve, reject) => {
            const jsonPath = path.join(srcDir, 'tsconfig.json')
            Bundler.readJson(jsonPath, (err, json) => {
                if (err) {
                    if (err.code === 'ENOENT')
                        return resolve('') // we are not using typescript
                    else if (err.text === "Error parsing .json file") {
                        // TODO add hjson parser: https://github.com/hjson/hjson-js
                        logger.warn(err);
                        /*json = {
                            compilerOptions: {
                                outDir: "./"
                            }
                        }
                        logger.warn("Using dummy tsconfig.json: %s", json);
                         */
                        this.ignoreExtensions.push(".ts");
                        logger.warn("Updater: Assuming TypeScript: expecting compiled files in same directory");
                        return resolve("");
                    }
                    else
                        return reject(err)
                }
                this.compilerJson = json;
                this.compilerOutDirDest = json.compilerOptions.outDir;
                if (!this.compilerOutDirDest) {
                    logger.warn("Updater: No outDir in tsconfig.json, using source directory");
                    return resolve(srcDir + path.sep);
                }

              let outDir = path.join(srcDir, json.compilerOptions.outDir)
                if (outDir && outDir.substr(-1) !== path.sep)
                    outDir += path.sep
                resolve(outDir)
            })
        })
    }

    getModuleConfig(modules) {
        return new Promise((resolve, reject) => {
            let moduleConfig = new Map() // (configFilePath, json)
            let moduleOps = []
            modules.forEach(((modulePath) => {
                moduleOps.push(this.readModuleConfig(moduleConfig, modulePath, "package.json"))
                moduleOps.push(this.readModuleConfig(moduleConfig, modulePath, "tsconfig.json"))
            }))
            Promise.all(moduleOps).then(() => {
                resolve(moduleConfig)
            }).catch((err) => {
                reject(err)
            })
        })
    }

    readModuleConfig(moduleConfig, modulePath, configFilename) {
        return new Promise((resolve, reject) => {
            const jsonPath = path.join(modulePath, configFilename)
            Bundler.readJson(jsonPath, (err, json) => {
                if (err) {
                    if (err.code === 'ENOENT' && configFilename === "tsconfig.json")
                        return resolve() // this module is not using typescript
                    return reject(err)
                }
                moduleConfig.set(jsonPath, json)
                resolve()
            })
        })
    }

    getCompiledModuleDirs(modules, filename) {
        let dirs = []
        for (let modulePath of modules)
        {
            //if (filename.substr(0, modulePath.length) === modulePath) {
                //return modulePath + path.sep
            let moduleBasename = path.sep + NodeModule.getBaseFromPath(modulePath) + path.sep
            if (filename.indexOf(moduleBasename) !== -1) {
                // our dependencies might look like this
                // [ '/SpiderManager/node_modules/apputils',
                // '/SpiderManager/node_modules/spider-core',
                // '/SpiderManager/node_modules/spider-core/node_modules/apputils', ... ]
                // so multiple modules can depend on the same module. we have to fix the path with all those modules
                // we do this by only returning the root folder of the module
                let packageJson = this.moduleConfig.get(path.join(modulePath, "package.json"))
                let tsconfig = this.moduleConfig.get(path.join(modulePath, "tsconfig.json"))
                let mod = new NodeModule(modulePath, packageJson, tsconfig)
                dirs.push(mod)
            }
        }
        return dirs
    }

    deleteCompiledDir(srcRoot, copyDest) {
        return new Promise((resolve, reject) => {
            if (!this.compiledOutputDir || !this.compilerOutDirDest) {
                return fs.ensureDir(path.join(copyDest, "node_modules"), (err) => { // in TS only mode
                    if (err)
                        return reject(err)
                    resolve()
                })
            }
            let copyCompiledDir = path.join(copyDest, this.compilerOutDirDest)

            fs.remove(copyCompiledDir, (err) => {
                if (err)
                    return reject(err)
                resolve()
            })
        })
    }

    getModuleDestRootDirs(copyDest, fullPath = true) {
        return new Promise((resolve, reject) => {
            const baseDir = path.join(copyDest, "node_modules")
            let resolveSubDir = () => {
                return new Promise((resolve, reject) => {

                })
            }
            fs.readdir(baseDir, (err, files) => {
                if (err)
                    return reject(err)
                //let resultFiles = files
                let resultFiles = []
                files.forEach((file) => {
                    if (file[0] !== "@") {
                        resultFiles.push(file)
                        return
                    }
                    const fullpath = path.join(baseDir, file)
                    try {
                        let dirFiles = fs.readdirSync(fullpath)
                        dirFiles.forEach((dirFile) => {
                            resultFiles.push(path.join(file, dirFile)) // will get joined more below
                        })
                    }
                    catch (e) {
                        logger.error("Error reading module dest dir: " + fullpath + " " + e.toString())
                    }
                })
                if (fullPath) {
                    for (let i = 0; i < resultFiles.length; i++)
                        resultFiles[i] = path.join(baseDir, resultFiles[i])
                }
                resolve(resultFiles)
            })
        })
    }

    modifyPackageJson(packageDirs, copySrc, copyDest) {
        return new Promise((resolve, reject) => {
            // we have to modify our json outDir path AFTER we copied them for the update bundle
            // because we removed the "build" dir

            // treat our workspaces as private packages too
            let listDirOps = []
            let workspaceProjects = new Set()
            this.workspaces.forEach((workspacePath) => {
                workspacePath = workspacePath.replace(copySrc, copyDest)
                listDirOps.push(new Promise((resolve, reject) => {
                    fs.readdir(workspacePath, (err, files) => {
                        if (err)
                            return reject(err)

                        files.forEach((filename) => {
                            const fullpath = path.join(workspacePath, filename)
                            if (packageDirs.indexOf(fullpath) === -1)
                                packageDirs.push(fullpath)
                            workspaceProjects.add(fullpath)
                        })
                        resolve()
                    })
                }))
            })
            Promise.all(listDirOps).then(() => {
                let modifyOps = []
                packageDirs.forEach((jsonDir) => {
                    const jsonFilePath = path.join(jsonDir, "package.json")
                    modifyOps.push(new Promise((resolve, reject) => {
                        fs.readFile(jsonFilePath, 'utf8', (err, data) => {
                            if (err)
                                return reject(err)
                            let json = helper.parseJson(data)
                            if (json === null)
                                return reject({text: 'Error parsing package.json to modify: ' + jsonFilePath})
                            if (!workspaceProjects.has(jsonDir)) {
                                if ((json.private !== true && json.bundleUpdate !== true) || !json.main)
                                    return resolve()
                            }
                            if (json.main === undefined || typeof json.main !== "string")
                                json.main = "";
                            json.main = json.main.replace(this.getCompileFolderName() + "/", "") // always UNIX style in json
                            if (json.typings)
                                json.typings = json.typings.replace(this.getCompileFolderName() + "/", "") // shouldn't really matter for typings
                            fs.writeFile(jsonFilePath, JSON.stringify(json, null, 4), 'utf8', (err) => {
                                if (err)
                                    return reject(err)
                                resolve()
                            })
                        })
                    }))
                })
                return Promise.all(modifyOps)
            }).then(() => {
                resolve()
            }).catch((err) => {
                reject({txt: "Error modifying package.json", err: err})
            })
        })
    }

    createBundleTempFolder(copyDest) {
        return new Promise((resolve, reject) => {
            fs.ensureDir(copyDest, (err) => {
                if (err)
                    return reject(err)
                resolve()
            })
        })
    }

    getCompileFolderName() {
        return path.basename(this.compiledOutputDir)/* + path.sep*/
    }

    loadWorkspaces(srcPath) {
        return new Promise((resolve, reject) => {
            if (!Array.isArray(this.json.workspaces))
                return resolve();

            let checkInstalledOps = []
            this.json.workspaces.forEach((workspaceName) => {
                let fullPath = path.join(srcPath, workspaceName).replace(/\*$/, "")
                this.workspaces.push(fullPath)
                checkInstalledOps.push(this.allWorkspaceModulesInstalled(fullPath))
                checkInstalledOps.push(this.addWorkspaceProjects(fullPath))
            })
            Promise.all(checkInstalledOps).then(() => {
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    addWorkspaceProjects(fullWorspacePath) {
        return new Promise((resolve, reject) => {
            let projects = this.workspaceProjects.get(fullWorspacePath)
            if (projects === undefined)
                projects = []
            this.workspaceProjects.set(fullWorspacePath, projects)
            fs.readdir(fullWorspacePath, (err, files) => {
                if (err)
                    return reject({txt: "Error reading workspace path", path: fullWorspacePath, err: err})

                files.forEach((file) => {
                    if (projects.indexOf(file) === -1)
                        projects.push(file)
                })
                resolve()
            })
        })
    }

    allWorkspaceModulesInstalled(workspacePath) {
        return new Promise((resolve, reject) => {
            // check if the module is installed in the workspace (currently yarn deletes = deduplicates installations when installing the root project)
            // installed modules are not bundled, but needed to run properly locally. this is a good place to check (and thus ensure our local tests
            // had all dependencies installed before shipping the update)
            if (this.ensureWorspaceModulesInstalled === false)
                return resolve()

            // load projects in this workspace
            fs.readdir(workspacePath, (err, files) => {
                if (err)
                    return reject({txt: "Error reading workspace path", path: workspacePath, err: err})

                // go through all projects in this workspace
                let checkProjectOps = []
                files.forEach((filename) => {
                    checkProjectOps.push(new Promise((resolve, reject) => {
                        let filepath = path.join(workspacePath, filename)
                        fs.stat(filepath, (err, stats) => {
                            if (err)
                                return reject({txt: "Error getting file stats", err: err})
                            if (stats.isDirectory() === false)
                                return resolve()
                            this.getSubModuleFileCount(filepath).then((count) => {
                                if (count < MIN_FILES_INSTALLED_NODE_MODULES)
                                    return reject({txt: "Sub node_modules dir must contain files to be considered installed", path: filepath, min: MIN_FILES_INSTALLED_NODE_MODULES, count: count})
                                resolve()
                            }).catch((err) => {
                                reject(err)
                            })
                        })
                    }))
                })
                Promise.all(checkProjectOps).then(() => {
                    resolve()
                }).catch((err) => {
                    reject(err)
                })
            })
        })
    }

    getSubModuleFileCount(subModuleDir) {
        return new Promise((resolve, reject) => {
            let modulePath = path.join(subModuleDir, MODULE_DIR)
            fs.readdir(modulePath, (err, files) => {
                if (err) {
                    if (err.code === 'ENOENT')
                        return reject({txt: "Sub node_modules dir not found. Module must be installed before bundling app.", dir: modulePath, err: err})
                    return reject({err: err})
                }
                resolve(files.length)
            })
        })
    }

    isWorkspaceModule(filePath) {
        for (let i = 0; i < this.workspaces.length; i++)
        {
            // skip all node_modules of a project in our worksapces // TODO old version. not working anymore?
            let regexStr = path.join(this.workspaces[i], "[^ \\" + path.sep + "]+", MODULE_DIR)
            regexStr = regexStr.replace(/\\/g, "\\\\");
            let curWorkspaceModulesDirRegex = new RegExp("^" + regexStr)

            if (curWorkspaceModulesDirRegex.test(filePath) === true)
                return true;

            // workspaces don't have compiled code under "build" of the root project
            if (this.compilerJson && this.compilerJson.compilerOptions && this.compilerJson.compilerOptions.outDir) {
                const workspaceName = path.basename(this.workspaces[i])
                // TODO add root module path in front to be safer?
                let curWorkspaceBuildDir = path.join(this.compilerJson.compilerOptions.outDir, workspaceName)
                if (curWorkspaceBuildDir[curWorkspaceBuildDir.length - 1] !== path.sep)
                    curWorkspaceBuildDir += path.sep;
                if (filePath.indexOf(curWorkspaceBuildDir) !== -1)
                    return true;
            }

            // new version: check if a project with this name exists in our workspace. then include it
            let start = filePath.lastIndexOf("@")
            if (start === -1)
                continue;
            start = filePath.indexOf(path.sep, start)
            if (start === -1)
                continue; // shouldn't happen
            let workspaceProjects = this.workspaceProjects.get(this.workspaces[i])
            let curProjectName = filePath.substr(start+1)
            let end = curProjectName.indexOf(path.sep)
            if (end !== -1)
                curProjectName = curProjectName.substr(0, end) // shouldn't be needed
            if (workspaceProjects.indexOf(curProjectName) !== -1 && helper.substrCount(filePath, "/node_modules/") >= 2)
                return true;
        }
        return false;
    }

    isIgnorePath(pathStr) {
        for (let ignore of this.ignorePaths)
        {
            if (pathStr.indexOf(ignore) === 0)
                return true;
        }
        return false;
    }
}

module.exports = Bundler
