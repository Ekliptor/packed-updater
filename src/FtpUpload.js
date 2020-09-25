const EasyFtp = require('@ekliptor/easy-ftp') // TODO we should be able to migrate back to original module
    , path = require('path')

let logger = console

class FtpUpload {
    constructor(settings) {
        // FTP (no SFTP) alternative (actively maintained): https://github.com/icetee/node-ftp
        this.ftp = new EasyFtp()
        this.settings = settings
        this.verifyFtpSettings();
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
                return this.disconnect();
            }).catch((err) => {
                reject(err)
            })
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    async connect() {
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

    disconnect() {
        this.ftp.close();
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
            let remoteDest = this.settings.ftpDestDir;
            if (remoteDest.substr(-1) !== "/")
                remoteDest += "/";
            remoteDest += bundleName;
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

    verifyFtpSettings() {
        if (!this.settings || typeof this.settings !== "object")
            throw new Error("'uploadSettings' must be a valid object");
        if (!this.settings.ftpDestDir || typeof this.settings.ftpDestDir !== "string")
            throw new Error("'uploadSettings.host' must be a directory path to upload");
        if (!this.settings.host || typeof this.settings.host !== "string")
            throw new Error("'uploadSettings.host' must be a valid hostname");
    }
}

module.exports = FtpUpload
