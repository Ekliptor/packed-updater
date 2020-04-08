const request = require('request')
    , path = require('path')
    , os = require('os')
    , fs = require('fs')
    , helper = require('./utils/helper')
    , Bundler = require('./Bundler')

let logger = console

const UPDATE_BUNDLE_DOWNLOAD_PREFIX_LEN = 20 // the length of random chars for temporary file download. in Update and Installer

class Update {
    constructor(srcRoot, packageJson) {
        this.srcRoot = srcRoot
        this.json = packageJson
    }

    static setLogger(loggerObj) {
        logger = loggerObj
    }

    check(updateJsonUrl) {
        return new Promise((resolve, reject) => {
            if (updateJsonUrl.match('\.json$') === null) {
                if (updateJsonUrl[updateJsonUrl.length - 1] !== '/')
                    updateJsonUrl += '/'
                updateJsonUrl += this.json.name + '.json'
            }
            let latestJson = null
            let localJson = null
            logger.log('Updater: Checking for latest version...')
            this.getLatestVersion(updateJsonUrl).then((updateJson) => {
                latestJson = updateJson
                return this.getLocalVersion()
            }).then((json) => {
                localJson = json
            }).then(() => {
                if (!localJson || localJson.sha1 !== latestJson.sha1) {
                    logger.log('Updater: New version available')
                    latestJson.newVersion = true
                }
                else {
                    logger.log('Updater: Already running latest version')
                    latestJson.newVersion = false
                }
                resolve(latestJson)
            }).catch((err) => {
                reject(err)
            })
        })
    }

    download(updateJsonUrl, bundle) {
        return new Promise((resolve, reject) => {
            let downloadUrl = bundle.bundleUrl
            if (!downloadUrl)
                return reject({text: 'no bundleUrl for download on ' + updateJsonUrl})
            if (downloadUrl.match('^https?://') === null)
                downloadUrl = helper.getWebDir(updateJsonUrl) + downloadUrl
            let downloadDest = path.join(os.tmpdir(), helper.getRandomString(UPDATE_BUNDLE_DOWNLOAD_PREFIX_LEN) + "-" + bundle.archiveName) // multiple updates can happen at the same time
            let destStream = fs.createWriteStream(downloadDest)
            logger.log('Updater: Downloading latest version...')
            request.get(this.getRequestOptions(downloadUrl))
                .on('error', (err) => {
                    this.removeBundleAfterFailedUpdate(downloadDest)
                    reject(err)
                })
                .on('end', () => {
                    logger.log('Updater: Downloaded update')
                    helper.hashFile(downloadDest).then(async (hash) => {
                        if (hash !== bundle.sha1) { // TODO log filesize too as it might be a corrupted download
                            this.removeBundleAfterFailedUpdate(downloadDest)
                            return reject({
                                text: 'Hash mismatch on ' + updateJsonUrl,
                                fileHash: hash,
                                requiredHash: bundle.sha1,
                                downloadSize: await helper.getFileSizeBytes(downloadDest)
                            })
                        }
                        bundle.dest = downloadDest
                        resolve()
                    })
                })
                .pipe(destStream)
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    getLatestVersion(updateJsonUrl) {
        return new Promise((resolve, reject) => {
            request(this.getRequestOptions(updateJsonUrl), (err, response, body) => {
                if (err)
                    return reject(err)
                let json = helper.parseJson(body)
                if (json == null)
                    return reject({text: 'invalid json on ' + updateJsonUrl})
                resolve(json)
            })
        })
    }

    getLocalVersion() {
        return new Promise((resolve, reject) => {
            let jsonPath = path.join(this.srcRoot, 'updater.json')
            Bundler.readJson(jsonPath, (err, json) => {
                if (err) {
                    if (err.code === 'ENOENT') // updater.json doesn't exist yet (first manual install)
                        return resolve(null)
                    return reject(err)
                }
                resolve(json)
            })
        })
    }

    removeBundleAfterFailedUpdate(destination) {
        fs.unlink(destination, (err) => {
            if (err)
                logger.error("Updater: Error deleting bundle after failed update: " + destination, err);
        });
    }

    getRequestOptions(urlStr) {
        return {
            url: urlStr,
            timeout: 12000 // in ms
        }
    }
}

module.exports = Update
