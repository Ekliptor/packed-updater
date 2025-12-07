/**
 * Tests for Installer.detectPackageManager()
 * Run with: node tests/detectPackageManager.test.js
 */

const path = require('path')
const fs = require('fs-extra')
const os = require('os')

// Mock the Installer class to test detectPackageManager in isolation
const Installer = require('../src/Installer')

// Test utilities
let testsPassed = 0
let testsFailed = 0

function assert(condition, message) {
    if (condition) {
        console.log(`  ✓ ${message}`)
        testsPassed++
    } else {
        console.log(`  ✗ ${message}`)
        testsFailed++
    }
}

async function createTestDir() {
    const testDir = path.join(os.tmpdir(), `installer-test-${Date.now()}`)
    await fs.ensureDir(testDir)
    return testDir
}

async function cleanup(testDir) {
    await fs.remove(testDir)
}

// Suppress logger output during tests
Installer.setLogger({
    log: () => {},
    warn: () => {},
    error: () => {}
})

// Test cases
async function testPnpmLockFile() {
    console.log('\nTest: pnpm-lock.yaml detection')
    const testDir = await createTestDir()

    try {
        // Create pnpm-lock.yaml
        await fs.writeFile(path.join(testDir, 'pnpm-lock.yaml'), 'lockfileVersion: 5.4\n')
        await fs.writeJson(path.join(testDir, 'package.json'), { name: 'test' })

        const installer = new Installer({ srcPath: testDir, bundle: {} }, [])
        await installer.detectPackageManager()

        // Only passes if pnpm is installed on this machine
        const pnpmInstalled = await installer.isCommandAvailable('pnpm --version')
        if (pnpmInstalled) {
            assert(installer.packageManager === 'pnpm', 'Should detect pnpm from pnpm-lock.yaml')
        } else {
            assert(installer.packageManager !== 'pnpm', 'Should not use pnpm if not installed')
        }
    } finally {
        await cleanup(testDir)
    }
}

async function testYarnLockFile() {
    console.log('\nTest: yarn.lock detection')
    const testDir = await createTestDir()

    try {
        // Create yarn.lock (no pnpm-lock.yaml)
        await fs.writeFile(path.join(testDir, 'yarn.lock'), '# yarn lockfile v1\n')
        await fs.writeJson(path.join(testDir, 'package.json'), { name: 'test' })

        const installer = new Installer({ srcPath: testDir, bundle: {} }, [])
        await installer.detectPackageManager()

        const yarnInstalled = await installer.isCommandAvailable('yarn --version')
        if (yarnInstalled) {
            assert(installer.packageManager === 'yarn', 'Should detect yarn from yarn.lock')
        } else {
            assert(installer.packageManager === 'npm', 'Should fallback to npm if yarn not installed')
        }
    } finally {
        await cleanup(testDir)
    }
}

async function testPackageLockFile() {
    console.log('\nTest: package-lock.json detection')
    const testDir = await createTestDir()

    try {
        // Create package-lock.json (no other lock files)
        await fs.writeJson(path.join(testDir, 'package-lock.json'), { lockfileVersion: 2 })
        await fs.writeJson(path.join(testDir, 'package.json'), { name: 'test' })

        const installer = new Installer({ srcPath: testDir, bundle: {} }, [])
        await installer.detectPackageManager()

        assert(installer.packageManager === 'npm', 'Should detect npm from package-lock.json')
    } finally {
        await cleanup(testDir)
    }
}

async function testPackageManagerFieldPnpm() {
    console.log('\nTest: packageManager field (pnpm)')
    const testDir = await createTestDir()

    try {
        await fs.writeJson(path.join(testDir, 'package.json'), {
            name: 'test',
            packageManager: 'pnpm@8.0.0'
        })

        const installer = new Installer({ srcPath: testDir, bundle: {} }, [])
        await installer.detectPackageManager()

        const pnpmInstalled = await installer.isCommandAvailable('pnpm --version')
        if (pnpmInstalled) {
            assert(installer.packageManager === 'pnpm', 'Should detect pnpm from packageManager field')
        } else {
            assert(installer.packageManager !== 'pnpm', 'Should not use pnpm if not installed')
        }
    } finally {
        await cleanup(testDir)
    }
}

async function testPackageManagerFieldYarn() {
    console.log('\nTest: packageManager field (yarn)')
    const testDir = await createTestDir()

    try {
        await fs.writeJson(path.join(testDir, 'package.json'), {
            name: 'test',
            packageManager: 'yarn@3.0.0'
        })

        const installer = new Installer({ srcPath: testDir, bundle: {} }, [])
        await installer.detectPackageManager()

        const yarnInstalled = await installer.isCommandAvailable('yarn --version')
        if (yarnInstalled) {
            assert(installer.packageManager === 'yarn', 'Should detect yarn from packageManager field')
        } else {
            assert(installer.packageManager === 'npm', 'Should fallback to npm if yarn not installed')
        }
    } finally {
        await cleanup(testDir)
    }
}

async function testPackageManagerFieldNpm() {
    console.log('\nTest: packageManager field (npm)')
    const testDir = await createTestDir()

    try {
        await fs.writeJson(path.join(testDir, 'package.json'), {
            name: 'test',
            packageManager: 'npm@9.0.0'
        })

        const installer = new Installer({ srcPath: testDir, bundle: {} }, [])
        await installer.detectPackageManager()

        assert(installer.packageManager === 'npm', 'Should detect npm from packageManager field')
    } finally {
        await cleanup(testDir)
    }
}

async function testFallbackToNpm() {
    console.log('\nTest: Fallback to npm when no lock files')
    const testDir = await createTestDir()

    try {
        // Only package.json, no lock files, no packageManager field
        await fs.writeJson(path.join(testDir, 'package.json'), { name: 'test' })

        const installer = new Installer({ srcPath: testDir, bundle: {} }, [])
        await installer.detectPackageManager()

        const yarnInstalled = await installer.isCommandAvailable('yarn --version')
        if (yarnInstalled) {
            assert(installer.packageManager === 'yarn', 'Should use yarn if available as fallback')
        } else {
            assert(installer.packageManager === 'npm', 'Should fallback to npm')
        }
    } finally {
        await cleanup(testDir)
    }
}

async function testManualOverridePnpm() {
    console.log('\nTest: Manual override with options.pnpm = true')
    const testDir = await createTestDir()

    try {
        await fs.writeJson(path.join(testDir, 'package.json'), { name: 'test' })

        const installer = new Installer({ srcPath: testDir, bundle: {}, pnpm: true }, [])
        await installer.detectPackageManager()

        assert(installer.packageManager === 'pnpm', 'Should use pnpm when options.pnpm = true')
    } finally {
        await cleanup(testDir)
    }
}

async function testManualOverrideYarn() {
    console.log('\nTest: Manual override with options.yarn = true')
    const testDir = await createTestDir()

    try {
        await fs.writeJson(path.join(testDir, 'package.json'), { name: 'test' })

        const installer = new Installer({ srcPath: testDir, bundle: {}, yarn: true }, [])
        await installer.detectPackageManager()

        assert(installer.packageManager === 'yarn', 'Should use yarn when options.yarn = true')
    } finally {
        await cleanup(testDir)
    }
}

async function testManualOverrideNpm() {
    console.log('\nTest: Manual override with options.yarn = false, options.pnpm = false')
    const testDir = await createTestDir()

    try {
        // Create yarn.lock to ensure it would normally detect yarn
        await fs.writeFile(path.join(testDir, 'yarn.lock'), '# yarn lockfile v1\n')
        await fs.writeJson(path.join(testDir, 'package.json'), { name: 'test' })

        const installer = new Installer({ srcPath: testDir, bundle: {}, yarn: false, pnpm: false }, [])
        await installer.detectPackageManager()

        assert(installer.packageManager === 'npm', 'Should use npm when both yarn and pnpm are false')
    } finally {
        await cleanup(testDir)
    }
}

async function testPriorityPnpmOverYarn() {
    console.log('\nTest: Priority - pnpm-lock.yaml takes precedence over yarn.lock')
    const testDir = await createTestDir()

    try {
        // Create both lock files
        await fs.writeFile(path.join(testDir, 'pnpm-lock.yaml'), 'lockfileVersion: 5.4\n')
        await fs.writeFile(path.join(testDir, 'yarn.lock'), '# yarn lockfile v1\n')
        await fs.writeJson(path.join(testDir, 'package.json'), { name: 'test' })

        const installer = new Installer({ srcPath: testDir, bundle: {} }, [])
        await installer.detectPackageManager()

        const pnpmInstalled = await installer.isCommandAvailable('pnpm --version')
        if (pnpmInstalled) {
            assert(installer.packageManager === 'pnpm', 'pnpm should take precedence over yarn')
        } else {
            const yarnInstalled = await installer.isCommandAvailable('yarn --version')
            if (yarnInstalled) {
                assert(installer.packageManager === 'yarn', 'Should fallback to yarn if pnpm not installed')
            } else {
                assert(installer.packageManager === 'npm', 'Should fallback to npm')
            }
        }
    } finally {
        await cleanup(testDir)
    }
}

// Run all tests
async function runTests() {
    console.log('='.repeat(50))
    console.log('Testing Installer.detectPackageManager()')
    console.log('='.repeat(50))

    try {
        await testPnpmLockFile()
        await testYarnLockFile()
        await testPackageLockFile()
        await testPackageManagerFieldPnpm()
        await testPackageManagerFieldYarn()
        await testPackageManagerFieldNpm()
        await testFallbackToNpm()
        await testManualOverridePnpm()
        await testManualOverrideYarn()
        await testManualOverrideNpm()
        await testPriorityPnpmOverYarn()
    } catch (err) {
        console.error('\nTest error:', err)
        testsFailed++
    }

    console.log('\n' + '='.repeat(50))
    console.log(`Results: ${testsPassed} passed, ${testsFailed} failed`)
    console.log('='.repeat(50))

    process.exit(testsFailed > 0 ? 1 : 0)
}

runTests()