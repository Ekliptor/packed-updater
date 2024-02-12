const path = require('path')
    , fs = require('fs-extra')
    //, tar = require('tar-fs')
    , tar = require('./libs/tarfs')
    , zlib = require('zlib')
    , fork = require('child_process').fork
    , spawn = require('child_process').spawn
    , exec = require('child_process').exec
    , os = require('os')
    , Bundler = require('./Bundler')
    , helper = require('./utils/helper')

// unfortunately updating packages too often is a bad idea since this often results in incompatible dependencies
// let's hope our npm packages grow more mature & stable here
const UPDATE_PACKAGES_DAYS = 120
const DEBUGGER_PORT = 43207
const updateProcessFile = path.join(__dirname, 'temp', 'updateProcess.js') // fixed location in module dir, so require() can find modules
//const UPDATE_BUNDLE_DOWNLOAD_PREFIX_LEN = 20 // the length of random chars for temporary file download. in Update and Installer
const CLEANUP_FULL_TEMP_PROBABILITY = 0.1

let logger = console // TODO write log to updater.log in app dir per default (if the app logger is used it might already be written)

let curInstanceData = {
    options: null
}

class Installer {
    constructor(options, restartCmd) {
        this.options = curInstanceData.options = options
        this.bundle = options.bundle
        this.installDir = options.srcPath
        this.restartCmd = restartCmd
        if (options.yarn === true)
            this.packageManager = "yarn";
        else if (options.yarn === false)
            this.packageManager = "npm";
        else
            this.packageManager = null; // autodetect
        if (!this.options.removeDirs) {
            /*this.options.removeDirs = ["build", "node_modules/apputils/build", "node_modules/spider-core/build",
                "node_modules/project-models/build", "node_modules/bit-models/build"]*/
            this.options.removeDirs = []
        }
        if (typeof this.options.removeOldBundles !== "boolean")
            this.options.removeOldBundles = true
    }

    static setLogger(loggerObj) {
        logger = loggerObj
    }

    static getLogger() {
        return logger
    }

    install() {
        return new Promise((resolve, reject) => {
            this.loadLocalBundle().then(() => {
                logger.log('Updater: Forking updater process...')
                return this.forkUpdater()
            }).then(() => {
                resolve() // NEVER reached when updater is successful, continue at resumeUpdate()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    resumeUpdate() {
        return new Promise((resolve, reject) => {
            logger.log('Updater: Extracting update...')
            this.loadLocalBundle().then(() => {
                return this.detectYarn()
            }).then(() => {
                return this.extractUpdate()
            }).then(() => {
                return this.setInstalled()
            }).then(() => {
                return this.maybeCleanupTemp()
            }).then(() => {
                return this.restartApp()
            }).then(() => {
                resolve() // NEVER reached when updater is successful, app restarts
            }).catch((err) => {
                reject(err)
            })
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    forkUpdater() {
        // we have to fork an update process because
        // 1. on windows we can't override files in use
        // 2. our main process might have some open ports. close the main process to ensure those ports are free when we restart the app
        return new Promise((resolve, reject) => {
            //let updateProcessFile = path.join(os.tmpdir(), 'updateProcess.js')
            fs.copy(path.join(__dirname, 'updateProcess.js'), updateProcessFile, async (err) => {
                if (err)
                    return reject(err)
                let processArgs = Object.assign([], process.execArgv)
                let dbg = false
                for (let i=0; i < processArgs.length; i++) {
                    if (processArgs[i].substr(0,12) == "--debug-brk=") {
                        processArgs[i] = "--debug-brk=" + DEBUGGER_PORT
                        dbg = true
                        break
                    }
                }
                let options = {
                    cwd: process.cwd(),
                    env: process.env,
                    execPath: process.execPath,
                    execArgv: processArgs, // don't change anything on the process arguments. process get's restarted with same args below
                    silent: false
                    //stdio:
                }
                options.env.IS_UPDATER = true;
                if (os.platform() === 'win32') {
                    options.detached = true;
                    //options.stdio = 'inherit';
                }
                /**
                 * TODO how to fix out of memory for updates?
                 * warn: Uncaught Exception
                 2017-05-04 21:04:23 - warn:  Error: spawn ENOMEM
                 at exports._errnoException (util.js:1033:11)
                 at ChildProcess.spawn (internal/child_process.js:319:11)
                 at exports.spawn (child_process.js:386:9)
                 at exports.fork (child_process.js:63:10)
                 at fs.copy (/home/project/nodejs/Project/SpiderManager/node_modules/packed-updater/src/Installer.js:89:31
                 */
                const child = fork(updateProcessFile, [], options)
                child.on('error', (err) => {
                    reject(err)
                })
                child.on('exit', (code, signal) => {
                    process.exit(0) // should never be reached
                })
                let cmdArr = [process.argv[0]]
                cmdArr = cmdArr.concat(process.execArgv) // node args or empty array
                cmdArr = cmdArr.concat(process.argv.slice(1))
                if (dbg)
                    debugger
                await helper.promiseDelay(300) // wait for child before sending messages (fails on windows otherwise)
                let sendResult = child.send({
                    installerData: curInstanceData,
                    //restartCmd: '"' + process.argv[0] + '" ' + process.execArgv.join(' ') + ' "' + process.argv.slice(1).join('" "') + '"'
                    restartCmd: cmdArr
                })
                if (sendResult !== true)
                    logger.log("Updater: Error sending update message to child process")
                setTimeout(() => { // wait just to be sure
                    process.exit(0) // release open ports and file handles (for windows)
                }, 0)
            })
        })
    }

    extractUpdate() {
        return new Promise((resolve, reject) => {
            try {
                const gunzip = zlib.createGunzip()
                let readStream = fs.createReadStream(this.bundle.dest) // throws an exception if this file in /tmp doesn't exist
                readStream.on('error', reject)
                readStream.on('end', resolve)
                readStream.pipe(gunzip).pipe(tar.extract(this.installDir)) // just overwrite everything
                    .on('error', reject) // error of write stream // TODO catching all?
                // TODO optional removeAllExistingFiles
                // TODO option to check file modification timestamps and not overwrite config files (.json)
            }
            catch (err) {
                reject(err)
            }
        })
    }

    setInstalled() {
        return new Promise((resolve, reject) => {
            let jsonPath = path.join(this.installDir, 'updater.json')
            this.bundle.installed = new Date().toISOString()
            if (!this.bundle.updated) // first install
                this.bundle.updated = new Date().toISOString()
            fs.writeFile(jsonPath, JSON.stringify(this.bundle, null, 4), 'utf8', (err) => {
                if (err)
                    return reject(err)
                // wait a little bit. npm install didn't install new dependencies once. probably because it loaded the package.json too early?
                setTimeout(resolve, 800)
            })
        })
    }

    maybeCleanupTemp() {
        return new Promise((resolve, reject) => {
            // the current bundle.tar.gz always gets removed in restartApp()
            // however updates might fail and collect old bundles in temp dir
            if (this.options.removeOldBundles === false || Math.random() > CLEANUP_FULL_TEMP_PROBABILITY)
                return resolve()

            logger.log('Updater: Cleaning up old updater bundle files from OS temp dir...')
            const tempDir = os.tmpdir()
            fs.readdir(tempDir, {encoding: "utf8"}, (err, files) => {
                if (err)
                    return reject(({txt: "Error cleaning up temp dir after install", dir: tempDir, err: err}))
                let removeOps = []
                const bundleRegex = new RegExp("^[a-z0-9]+\-[a-z0-9]+\.tar.\gz$", "i") // could also use {UPDATE_BUNDLE_DOWNLOAD_PREFIX_LEN}
                files.forEach((file) => {
                    // remove files such as: zUAd45GCQzPejDectgIX-ProjectName.tar.gz
                    if (bundleRegex.test(file) === false)
                        return
                    let filePath = path.join(tempDir, file)
                    removeOps.push(new Promise((resolve, reject) => {
                        fs.remove(filePath, (err) => {
                            //if (err) // swallow these errors as its mostly a permission issue (owned by another user)
                                //logger.error("Error removing updater file: " + filePath, err)
                            resolve()
                        })
                    }))
                })
                Promise.all(removeOps).then(() => {
                    resolve()
                }).catch((err) => {
                    logger.error("Error removing updater bundle file", err)
                    resolve() // continue
                })
            })
        })
    }

    restartApp() {
        return new Promise((resolve, reject) => {
            // skip debugger port, this process only calls npm install. not much to debug there
            let options = {
                encoding: 'utf8',
                //timeout: timeoutMs, // send killSignal after timeout ms
                //maxBuffer: 500 * 1024 * 1024, // max bytes in stdout or stderr // 500 mb
                killSignal: 'SIGTERM',
                cwd: process.cwd(),
                env: process.env // key-value pairs
            }
            if (options.env.IS_UPDATER)
                delete options.env.IS_UPDATER;
            let cleanupDone = false
            let cleanup = () => {
                if (cleanupDone === true)
                    return
                cleanupDone = true
                logger.log('Updater: Install & Restart done')
                // our app restarted, cleanup & exit
                let removeDirs = [path.dirname(updateProcessFile), this.bundle.dest]
                let removeOps = []
                removeDirs.forEach((dir) => {
                    removeOps.push(new Promise((resolve, reject) => {
                        fs.remove(dir, (err) => {
                            if (err)
                                logger.error(err)
                            resolve()
                        })
                    }))
                })
                Promise.all(removeOps).then(() => {
                    logger.log('Updater: Done cleanup. Updater exited')
                    process.exit(0) // wait for child
                })
            }

            logger.log('Updater: Installing app...')
            let installCmd = this.packageManager + ' install'
            if (!this.options.installDevDependencies)
                installCmd += ' --production'
            const installChild = exec(installCmd, options, (err, stdout, stderr) => {
                if (err)
                    return reject(err)

                this.removeDirs().then(() => {
                    return this.runUpdate(options)
                }).then(() => {
                    if (this.options.exitAfterUpdate)
                        return process.exit(0)
                    // TODO still not working. setInstalled() isn't even called with systemd
                    // we don't use systemd and use a bash script instead for now
                    /*
                     if (process.env.NODE_ENV === 'production') {
                     // we run on systemd (or other boot system), let systemd restart the app
                     logger.log('Updater: Letting system handle the restart')
                     process.exit(0)
                     }
                     */

                    options.detached = true // make it the new "parent" or group leader
                    options.stdio = 'ignore' // needed for parent to exit, no more output (except logfiles)
                    //if (os.platform() === 'win32') {
                        //options.stdio = 'inherit'; // on windows we keep the CMD window open anyway, so keep showing output
                    //}
                    const child = spawn(this.restartCmd[0], this.restartCmd.slice(1), options)
                    child.on('close', (code, signal) => { // not exit, wait for all streams to close
                        process.exit(code)
                    })
                    child.on('error', (err) => {
                        reject(err)
                    })
                    //child.stderr.pipe(process.stderr)
                    //child.stdout.pipe(process.stdout)
                    //child.stdin.on('data', (data) => {
                    // shouldn't happen, if anything the parent process receives input
                    //})
                    child.unref()

                    /*
                     let exitHandler = () => {
                     logger.log("killing")
                     child.kill()
                     }
                     process.on('exit', exitHandler)
                     process.on('SIGINT', exitHandler) // ctrl + c
                     process.on('uncaughtException', exitHandler)
                     */
                    setTimeout(cleanup, 500) // or wait for data on child.on('data') ??
                })
            })
        })
    }

    loadLocalBundle() {
        return new Promise((resolve, reject) => {
            // this.bundle holds the remote json. we have to add local properties
            let jsonPath = path.join(this.installDir, 'updater.json')
            logger.log('Updater: Installing in: %s', this.installDir)
            Bundler.readJson(jsonPath, (err, json) => {
                if (err) { // doesn't exist or invalid. continue
                    if (err.code !== "ENOENT")
                        logger.error("Error reading local updater.json file", err)
                    return resolve()
                }
                if (json.installed)
                    this.bundle.installed = new Date(json.installed)
                if (json.updated)
                    this.bundle.updated = new Date(json.updated)
                resolve()
            })
        })
    }

    runUpdate(options) {
        return new Promise((resolve, reject) => {
            if (!this.bundle.updated)
                return resolve() // this is the first install. we set updated == installed
            const lastUpdate = new Date(this.bundle.updated); // be sure we get a date object (and not a string)
            if (lastUpdate.getTime() + UPDATE_PACKAGES_DAYS * 24*60*60*1000 > Date.now())
                return resolve()
            let setUpdated = () => {
                this.setLastUpdate().then(() => {
                    resolve()
                }).catch((err) => {
                    logger.error("Error setting last update", err)
                    resolve()
                })
            }
            if (this.packageManager !== "npm") // yarn manages up-2-date dependencies automatically
                return setUpdated();

            logger.log('Updater: Updating dependencies...')
            let updateCmd = 'npm update'
            if (this.options.installDevDependencies)
                updateCmd += ' --dev' // here default is no dev
            const updateChild = exec(updateCmd, options, (err, stdout, stderr) => {
                if (err)
                    return reject(err)
                setUpdated()
            })
        })
    }

    removeDirs() {
        return new Promise((resolve, reject) => {
            let removeOps = []
            let baseDirs = [this.installDir]
            this.options.removeDirs.forEach((dirName) => {
                baseDirs.forEach((baseDir) => {
                    let dirPath = path.join(baseDir, dirName)
                    removeOps.push(new Promise((resolve, reject) => {
                        fs.remove(dirPath, (err) => {
                            if (err && err.code !== "ENOENT")
                                logger.error("Error deleting to-remove dir: " + dirPath, err) // still continue
                            resolve()
                        })
                    }))
                })
            })
            Promise.all(removeOps).then(() => {
                resolve()
            })
        })
    }

    setLastUpdate() {
        return new Promise((resolve, reject) => {
            let jsonPath = path.join(this.installDir, 'updater.json')
            this.bundle.updated = new Date().toISOString()
            fs.writeFile(jsonPath, JSON.stringify(this.bundle, null, 4), 'utf8', (err) => {
                if (err)
                    return reject(err)
                // wait a little bit to be sure the next read call is correct
                setTimeout(resolve, 200)
            })
        })
    }

    detectYarn() {
        return new Promise((resolve, reject) => {
            if (this.packageManager)
                return resolve()
            let options = {
                encoding: 'utf8',
                //timeout: timeoutMs, // send killSignal after timeout ms
                //maxBuffer: 500 * 1024 * 1024, // max bytes in stdout or stderr // 500 mb
                killSignal: 'SIGTERM',
                cwd: process.cwd(),
                env: process.env // key-value pairs
            }
            const detectChild = exec("yarn -h", options, (err, stdout, stderr) => {
                if (err)
                    return reject({txt: "Error detecting yarn", err: err}) // shouldn't happen
                if (!stdout || stdout.indexOf("yarnpkg.com") === -1) {
                    this.packageManager = "npm";
                    logger.log('Using NPM package manager. Consider installing yarn if you encounter problems.')
                }
                else {
                    this.packageManager = "yarn";
                    logger.log('Updater: Found yarn package manager. Using it')
                }
                resolve()
            })
        })
    }
}

module.exports = Installer
