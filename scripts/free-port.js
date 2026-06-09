const { execSync } = require('child_process');

const port = process.argv[2] || process.env.PORT || 3002;

const getWindowsPowerShell = () => {
    if (process.env.SystemRoot) {
        return `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    }
    return 'powershell.exe';
};

const freePort = () => {
    if (process.platform !== 'win32') {
        try {
            execSync(`lsof -ti:${port} | xargs kill -9`, { stdio: 'ignore' });
            console.log(`Freed port ${port}`);
        } catch {
            // port already free
        }
        return;
    }

    try {
        const ps = getWindowsPowerShell();
        const output = execSync(
            `"${ps}" -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique"`,
            { encoding: 'utf8' }
        );
        const pids = [...new Set(output.trim().split(/\r?\n/).filter(Boolean))];
        for (const pid of pids) {
            const procId = Number(pid);
            if (!Number.isFinite(procId) || procId <= 0 || procId === process.pid) continue;
            try {
                process.kill(procId, 'SIGTERM');
                console.log(`Freed port ${port} (stopped PID ${procId})`);
            } catch {
                // process may already be gone
            }
        }
    } catch {
        // port already free
    }
};

freePort();
