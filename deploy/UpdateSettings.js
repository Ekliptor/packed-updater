module.exports.set = {
    uploadSettings: {
        ftpDestDir: '/relative/path/of/ftp-account/', // where to upload the file to
        host: 'your-domain-or-ip.com',
        port: 22, // FTP port
        username: 'abc', // FTP username
        password: 'fooo', // FTP password
        type: 'sftp', // ftp or sftp
        // privateKey: '' // optional file with key for auth with sftp
    }
}
