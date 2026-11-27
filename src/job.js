// A parent-owned, non-inheritable handle protects a gated child before it can spawn.
export async function createJob() {
  if (process.platform !== 'win32') return { assign() {}, close() {} };
  const { default: koffi } = await import('koffi');
  const kernel = koffi.load('kernel32.dll');
  const create = kernel.func('void * __stdcall CreateJobObjectW(void *, const char16_t *)');
  const set = kernel.func('bool __stdcall SetInformationJobObject(void *, int, void *, uint32_t)');
  const open = kernel.func('void * __stdcall OpenProcess(uint32_t, bool, uint32_t)');
  const assign = kernel.func('bool __stdcall AssignProcessToJobObject(void *, void *)');
  const close = kernel.func('bool __stdcall CloseHandle(void *)');
  const handle = create(null, null);
  if (!handle) throw new Error('Cannot create Windows Job Object');
  // JOBOBJECT_EXTENDED_LIMIT_INFORMATION, Windows x64/arm64 layout.
  const limits = Buffer.alloc(process.arch === 'ia32' ? 112 : 144);
  limits.writeUInt32LE(0x2000, 16); // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
  if (!set(handle, 9, limits, limits.length)) { close(handle); throw new Error('Cannot configure Windows Job Object'); }
  let closed = false;
  return {
    assign(pid) {
      const processHandle = open(0x101, false, pid); // SET_QUOTA | TERMINATE
      if (!processHandle) throw new Error('Cannot open owned child process');
      try { if (!assign(handle, processHandle)) throw new Error('Cannot assign owned child to Windows Job Object'); }
      finally { close(processHandle); }
    },
    close() { if (!closed) { closed = true; close(handle); } },
  };
}
