const [major, minor] = process.versions.node.split('.').map(Number);
const supported = (major === 24 && minor >= 15) || major === 26;

if (!supported) {
  console.error(
    [
      `Unsupported Node.js ${process.versions.node}.`,
      'Git Khronos requires Node.js 24.15 or newer in the 24.x LTS line, or Node.js 26.x.',
      'If you use nvm, run: nvm install && nvm use',
    ].join('\n'),
  );
  process.exit(1);
}

console.log(`Node.js ${process.versions.node} is supported.`);
