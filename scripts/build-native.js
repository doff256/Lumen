'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');
if (process.platform === 'win32') {
  const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  execFileSync(compiler, ['/nologo', '/optimize+', '/target:exe', '/reference:System.Web.Extensions.dll', '/reference:System.Management.dll', '/out:' + path.resolve('src/monitor/native.exe'), path.resolve('src/monitor/native.cs')], { stdio: 'inherit', windowsHide: true });
}
