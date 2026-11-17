// electron-builder afterPack hook: rcedit the packaged executable at the moment it is
// produced, so the icon and version metadata land in win-unpacked *and* in the NSIS
// installer's embedded payload. Without this, building the installer re-packages the app
// and silently drops whatever a post-build script had patched.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

module.exports = async function afterPack(context) {
  const productName = context.packager.appInfo.productFilename
  const exe = path.join(context.appOutDir, `${productName}.exe`)
  execFileSync(process.execPath, [path.join(__dirname, 'patch-exe.mjs'), exe], {
    stdio: 'inherit',
    cwd: context.packager.projectDir
  })
}
