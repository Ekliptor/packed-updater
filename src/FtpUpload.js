const EasyFtp = require('easy-ftp')
    , path = require('path')

let logger = console

class FtpUpload {
    constructor(settings) {
        this.ftp = new EasyFtp()
        this.settings = settings
    }

    static setLogger(loggerObj) {
        logger = loggerObj
    }

    uploadBundle(bundle) {
        return new Promise((resolve, reject) => {
            logger.log('Updater: Connecting via FTP...')
            this.connect().then(() => {
                return this.createUploadDir()
            }).then(() => {
                logger.log('Updater: Uploading bundle...')
                return this.upload(bundle)
            }).then(() => {
                logger.log('Updater: Uploaded bundle')
                bundle.uploaded = true
                resolve()
            }).catch((err) => {
                reject(err)
            })
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    connect() {
        return new Promise((resolve, reject) => {
            let connected = false
            this.ftp.connect(this.settings)
            this.ftp.on('error', (err) => {
                if (connected === false)
                    return reject(err)
                logger.error('FTP error', err)
            })
            this.ftp.on('open', (client) => {
                connected = true
                resolve()
            })
            this.ftp.on('close', () => {
                connected = false
            })
            this.ftp.on('upload', (remotePath) => {
            })
            this.ftp.on('download', (localPath) => {
            })
        })
    }

    createUploadDir() {
        return new Promise((resolve, reject) => {
            this.ftp.exist(this.settings.ftpDestDir, (exist) => {
                if (exist === true)
                    return resolve()
                this.ftp.mkdir(this.settings.ftpDestDir, (err) => {
                    if (err)
                        return reject(err)
                    resolve()
                })
            })
        })
    }

    upload(bundle) {
        return new Promise((resolve, reject) => {
            let bundleName = path.basename(bundle.dest)
            let remoteDest = this.settings.ftpDestDir + '/' + bundleName // for remote dir always use "/"
            this.ftp.upload(bundle.dest, remoteDest, (err) => {
                if (err)
                    return reject(err)
                let jsonName = path.basename(bundle.jsonDest)
                remoteDest = this.settings.ftpDestDir + '/' + jsonName
                this.ftp.upload(bundle.jsonDest, remoteDest, (err) => {
                    if (err)
                        return reject(err)
                    // TODO verify size after upload using ls(path, (err, list))
                    resolve()
                })
            })
        })
    }
}

module.exports = FtpUpload
