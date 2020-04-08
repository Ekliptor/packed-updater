// this file is the entry point of fork()

const path = require('path')
const Installer = require(path.join(__dirname, '..', 'Installer'))

const resumeUpdate = (installerData, restartCmd) => {
    let installer = new Installer(installerData, restartCmd)
    installer.resumeUpdate().then(() => {
        // won't be reached
    }).catch((err) => {
        Installer.getLogger().error(err)
        process.exit(1)
    })
}

process.on('message', (message) => {
    setTimeout(() => {
        resumeUpdate(message.installerData.options, message.restartCmd)
    }, 600)
})