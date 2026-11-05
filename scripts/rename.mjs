import { renameSync } from 'node:fs'

// vite-plugin-singlefile 产物默认名 index.html,重命名为分发名
renameSync(new URL('../dist/index.html', import.meta.url), 'dist/trip-scope.html')
console.log('[rename] dist/index.html -> dist/trip-scope.html')
