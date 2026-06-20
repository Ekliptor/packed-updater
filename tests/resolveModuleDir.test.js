/**
 * Tests for Bundler.resolveModuleDir()
 * Run with: node tests/resolveModuleDir.test.js
 *
 * Verifies cross-package-manager dependency resolution stays backwards compatible:
 *   - npm v2 / Yarn classic: nested <root>/node_modules/<dep>
 *   - npm v3+ / Yarn hoisting: dep hoisted into a parent node_modules
 *   - pnpm: dep symlinked, real deps next to the module's real location (.pnpm store)
 *   - missing dependency: returns null instead of throwing
 */

const path = require('path')
const fs = require('fs-extra')
const os = require('os')

const Bundler = require('../src/Bundler')

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
    const testDir = path.join(os.tmpdir(), `bundler-resolve-test-${Date.now()}-${testsPassed + testsFailed}`)
    await fs.ensureDir(testDir)
    return testDir
}

async function cleanup(testDir) {
    await fs.remove(testDir)
}

// Compare two paths by their canonical (symlink-resolved) form. resolveModuleDir's
// fallback returns realpath-resolved dirs, and os.tmpdir() is itself a symlink on
// macOS (/var -> /private/var), so raw string comparison would give false negatives.
function samePath(a, b) {
    if (a === null || b === null)
        return a === b
    return fs.realpathSync(a) === fs.realpathSync(b)
}

// Write a minimal package.json for a module dir
async function writePkg(dir, json) {
    await fs.ensureDir(dir)
    await fs.writeJson(path.join(dir, 'package.json'), json)
}

// Suppress logger output during tests
Bundler.setLogger({
    log: () => {},
    warn: () => {},
    error: () => {}
})

// resolveModuleDir uses no instance state, so an empty packageJson is fine
const bundler = new Bundler({})

// Test cases
async function testNestedLayout() {
    console.log('\nTest: nested layout (npm v2 / Yarn classic)')
    const testDir = await createTestDir()

    try {
        const root = path.join(testDir, 'app')
        const depDir = path.join(root, 'node_modules', 'dep')
        await writePkg(depDir, { name: 'dep', version: '1.0.0' })

        const resolved = bundler.resolveModuleDir(root, 'dep')
        assert(samePath(resolved, depDir), 'Should return the nested node_modules/<dep> dir')
    } finally {
        await cleanup(testDir)
    }
}

async function testScopedNestedLayout() {
    console.log('\nTest: nested layout with scoped package name')
    const testDir = await createTestDir()

    try {
        const root = path.join(testDir, 'app')
        const depDir = path.join(root, 'node_modules', '@scope', 'dep')
        await writePkg(depDir, { name: '@scope/dep', version: '1.0.0' })

        const resolved = bundler.resolveModuleDir(root, '@scope/dep')
        assert(samePath(resolved, depDir), 'Should resolve a scoped dependency nested')
    } finally {
        await cleanup(testDir)
    }
}

async function testHoistedLayout() {
    console.log('\nTest: hoisted layout (npm v3+ / Yarn hoisting)')
    const testDir = await createTestDir()

    try {
        // module lives at <root>/node_modules/mod, but its dep "subdep" is hoisted
        // up into <root>/node_modules (a parent node_modules of mod).
        const root = path.join(testDir, 'app')
        const modDir = path.join(root, 'node_modules', 'mod')
        await writePkg(modDir, { name: 'mod', version: '1.0.0' })
        const hoistedDep = path.join(root, 'node_modules', 'subdep')
        await writePkg(hoistedDep, { name: 'subdep', version: '1.0.0' })

        // resolving subdep from mod must NOT find it nested under mod, but in the parent
        const resolved = bundler.resolveModuleDir(modDir, 'subdep')
        assert(samePath(resolved, hoistedDep), 'Should find the hoisted dep in a parent node_modules')
    } finally {
        await cleanup(testDir)
    }
}

async function testSymlinkedLayout() {
    console.log('\nTest: symlinked layout (pnpm .pnpm store)')
    const testDir = await createTestDir()

    try {
        // Real location of mod, with its own dep "subdep" next to it (pnpm style).
        const realModDir = path.join(testDir, 'store', 'mod@1.0.0', 'node_modules', 'mod')
        await writePkg(realModDir, { name: 'mod', version: '1.0.0' })
        const realSubDep = path.join(testDir, 'store', 'mod@1.0.0', 'node_modules', 'subdep')
        await writePkg(realSubDep, { name: 'subdep', version: '1.0.0' })

        // Top-level node_modules/mod is a SYMLINK to the real location.
        const linkDir = path.join(testDir, 'app', 'node_modules')
        await fs.ensureDir(linkDir)
        const symlinkedMod = path.join(linkDir, 'mod')

        let symlinkOk = true
        try {
            await fs.symlink(realModDir, symlinkedMod, 'dir')
        } catch (e) {
            symlinkOk = false
            console.log('  (skipped: symlink creation not permitted on this filesystem)')
        }

        if (symlinkOk) {
            // subdep is NOT nested under the symlink; only realpath resolution finds it.
            const resolved = bundler.resolveModuleDir(symlinkedMod, 'subdep')
            assert(samePath(resolved, realSubDep), 'Should find the dep next to the symlink-resolved real dir')
        }
    } finally {
        await cleanup(testDir)
    }
}

async function testMissingDependency() {
    console.log('\nTest: missing dependency returns null (no throw)')
    const testDir = await createTestDir()

    try {
        const root = path.join(testDir, 'app')
        await fs.ensureDir(path.join(root, 'node_modules'))

        let threw = false
        let resolved
        try {
            resolved = bundler.resolveModuleDir(root, 'does-not-exist')
        } catch (e) {
            threw = true
        }
        assert(!threw, 'Should not throw for a missing dependency')
        assert(resolved === null, 'Should return null for a missing dependency')
    } finally {
        await cleanup(testDir)
    }
}

// Run all tests
async function runTests() {
    console.log('='.repeat(50))
    console.log('Testing Bundler.resolveModuleDir()')
    console.log('='.repeat(50))

    try {
        await testNestedLayout()
        await testScopedNestedLayout()
        await testHoistedLayout()
        await testSymlinkedLayout()
        await testMissingDependency()
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