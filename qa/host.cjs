const vscode = require('vscode');
const http = require('node:http');
exports.run = async function () {
  const ext = vscode.extensions.getExtension('hanchen-ge.codesim-frontend');
  if (!ext) throw Error('CodeSim extension missing');
  await ext.activate();
  await vscode.commands.executeCommand('codesim-frontend.openViewer');
  console.log('REAL_EXTENSION_ACTIVE', vscode.version, ext.extensionPath);
  await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        if (req.url === '/signals') await vscode.commands.executeCommand('codesim-frontend.openSignals');
        if (req.url === '/closePanel') await vscode.commands.executeCommand('workbench.action.closePanel');
        if (req.url === '/viewer') await vscode.commands.executeCommand('codesim-frontend.openViewer');
        if (req.url === '/done') { res.end('done'); server.close(); resolve(); return; }
        res.end(JSON.stringify({active: ext.isActive, version: vscode.version}));
      } catch (e) { res.statusCode = 500; res.end(String(e)); }
    });
    server.on('error', reject);
    server.listen(9333, '127.0.0.1');
  });
};
