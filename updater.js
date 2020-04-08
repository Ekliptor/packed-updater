"use strict";

// main file to expose the Updater API
// interesting similar module: https://www.npmjs.com/package/auto-updater

const fs = require('fs')
    , path = require('path')
    , os = require('os')
    , helper = require('./src/utils/helper')
    , Bundler = require('./src/Bundler')
    , FtpUpload = require('./src/FtpUpload')
    , Update = require('./src/Update')
    , Installer = require('./src/Installer')
    , cluster = require('cluster')

const PREVENT_DEV_OVERWRITE = true

let logger = console

class Updater {
    constructor() {
    }

    /*static */setLogger(loggerObj) {
        logger = loggerObj
        Bundler.setLogger(loggerObj)
        FtpUpload.setLogger(loggerObj)
        Update.setLogger(loggerObj)
        Installer.setLogger(loggerObj)
    }

    /**
     * Creates a .tar.gz bundle archive of your app.
     * @param options {
     *      srcPath: (String) Path to the root directory of your app (must have a package.json file).
     *      bundleDestDir: (String) Path where to place the .tar.gz file for upload.
     *      addSourceMaps: (boolean, default true) Add .js.map files to the bundle.
     *      uploadSettings: {
     *          ftpDestDir: '',
     *          host: '',
     *          port: 21,
     *          username: '',
     *          password: '',
     *          type: 'ftp|sftp', // default: ftp
     *          privateKey: '' // optional file with key for auth with sftp
     *      }
     *      bundleDevDependencies: (bool) default false
     *      enforceModuleVersions: (object) Pin npm dependencies a specify version.
     *      addVersion: (bool, default false) add version number to archive name
     *      ignorePaths: string[] some paths with app data you don't want to bundle
     *      ensureWorspaceModulesInstalled (bool, default true) Ensure all modules of our local workspaces are installed before shipping the update.
     *          When using yarn workspaces this is a safety check to ensure your app is starting before shipping the update.
     * }
     * Will only bundle packages set to private (or bundleUpdate): true. privateNoInstall: true Means their dependencies will not be bundled
     *
     * @param callback(err, bundle)
     */
    createBundle(options, callback) {
        if (!options.srcPath || options.srcPath.length === 0 || !options.bundleDestDir || options.bundleDestDir.length === 0)
            return callback({text: 'You must specify options.srcPath and options.bundleDestDir'})
        // not required currently, but let's be safe for future changes
        else if (options.bundleDestDir.substr(0, options.srcPath) === options.srcPath)
            return callback({text: 'options.bundleDestDir must be outside of options.srcPath'})

        // fix for typescript (or other compiled code): we need the root dir because node_modules only exists there
        if (options.srcPath.match('\\' + path.sep + 'build'))
            options.srcPath = options.srcPath.replace(new RegExp('\\' + path.sep + 'build'), '')

        let jsonPath = path.join(options.srcPath, 'package.json')
        Bundler.readJson(jsonPath, (err, json) => {
            if (err)
                return callback(err)
            let bundlerObj = new Bundler(json)
            let dependencies = ['dependencies']
            if (options.bundleDevDependencies)
                dependencies.push('devDependencies')

            let bundle = null
            bundlerObj.bundle(dependencies, options).then((bundleRes) => {
                bundle = bundleRes
                if (options.uploadSettings) {
                    let ftpUpload = new FtpUpload(options.uploadSettings)
                    return ftpUpload.uploadBundle(bundle)
                }
            }).then(() => {
                callback(null, bundle)
            }).catch((err) => {
                callback(err)
            })
        })
    }

    /** Checks for updates of your app.
     * It will detect new versions based on the hash of the bundle (IGNORES the version number).
     * @param options {
     *      srcPath: (String, optional) Path to the root directory of your app (should contain an updater.json file or else will assume the update is new)
     *          If not set, it will assume the current working directory.
     *      updateJsonUrl: (String) if it doesn't end with ".json", then "name.json" will be appended with the name from package.json
     *      download: (bool) // download & verify the update in a local directory
     * }
     * @param callback(err, bundle) bundle will hold the contents of the remote updater.json file with additional properties:
     *          newVersion: (bool) if there is a new version available
     *          dest: (String) the local path of the downloaded bundle (if download == true)
     */
    checkUpdates(options, callback) {
        // tar xzf archive.tar.gz
        if (this.isChild())
            return callback({text: "Checking for updates in child process is not supported"})
        if (!options.srcPath)
            options.srcPath = process.cwd()
        if (!options.updateJsonUrl)
            return callback({text: 'You must specify options.updateJsonUrl'})

        let jsonPath = path.join(options.srcPath, 'package.json')
        Bundler.readJson(jsonPath, (err, json) => {
            if (err)
                return callback(err)
            let update = new Update(options.srcPath, json)
            let bundle = null
            update.check(options.updateJsonUrl).then((bundleContents) => {
                bundle = bundleContents
                if (bundleContents.newVersion && options.download)
                    return update.download(options.updateJsonUrl, bundle)
            }).then(() => {
                callback(null, bundle)
            }).catch((err) => {
                callback(err)
            })
        })
    }

    /**
     * Installs a previously downloaded update.
     * It will:
     *      1. start the updater process
     *      2. close the app
     *      3. extract the bundle
     *      4. run npm install
     *      5. start the new app
     * The callback will only be called on error. Otherwise the app will be restarted WITHOUT calling this.
     * You should cleanup your open sockets etc before calling this to allow the app to shutdown gracefully.
     * @param options {
     *      yarn: (boolean, optional): use yarn instead of npm. default = auto detect = true if yarn is installed
     *      srcPath: (String, optional) Path to the root directory of your app
     *      bundle: (Object) an update previously downloaded with checkUpdates()
     *      exitAfterUpdate: (boolean, default false) Exit the node process after the update instead of restarting it.
     *      installDevDependencies: (bool) default false, also see bundleDevDependencies
     *      liveupdate: (bool) // close the app after npm install to minimize downtime // TODO only linux (windows can't overwrite files in use)
     *      removeAllExistingFiles: (bool) // TODO optional flag to remove all existing files, dangerous with web apps that host user content
     *      removeDirs: string[] optionally remove (build) dirs (compiled code gets copied to the root dirs of packages by updater). default none []
     *      removeOldBundles: (boolean optional): Remove old updater bundles from OS temp directory. Default = true
     * }
     * @param callback(err)
     */
    installUpdate(options, callback) {
        if (this.isChild())
            return callback({text: "Installing updates in child process is not supported"})
        if (!options.srcPath)
            options.srcPath = process.cwd()
        if (typeof options.bundle !== 'object')
            return callback({text: 'You must specify options.bundle'})
        else if (!options.bundle.dest)
            return callback({text: 'Your options.bundle.dest must contain the downloaded archive'})
        else if (PREVENT_DEV_OVERWRITE === true && (os.platform() === 'darwin' || os.platform() === 'win32'))
            return callback({text: 'PREVENT_DEV_OVERWRITE prevents you from overwriting sources on your machine'})

        let insaller = new Installer(options)
        insaller.install().then(() => {
            callback(null, 1)
        }).catch((err) => {
            callback(err)
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    isChild() {
        return process.env.IS_CHILD || !cluster.isMaster
    }
}

const updaterInstance = new Updater()
module.exports = updaterInstance
