param([Parameter(Mandatory = $true)][string]$ExecutablePath)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ExhibitionManifestResource {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr LoadLibraryExW(string name, IntPtr file, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr FindResourceW(IntPtr module, IntPtr name, IntPtr type);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint SizeofResource(IntPtr module, IntPtr resource);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr LoadResource(IntPtr module, IntPtr resource);
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr LockResource(IntPtr resource);
    [DllImport("kernel32.dll")]
    public static extern bool FreeLibrary(IntPtr module);
}
'@
$path = (Resolve-Path $ExecutablePath).Path
$module = [ExhibitionManifestResource]::LoadLibraryExW($path, [IntPtr]::Zero, 2)
if ($module -eq [IntPtr]::Zero) { throw '无法读取Windows成品资源' }
try {
    $resource = [ExhibitionManifestResource]::FindResourceW($module, [IntPtr]1, [IntPtr]24)
    if ($resource -eq [IntPtr]::Zero) { throw 'Windows成品缺少应用清单资源' }
    $size = [ExhibitionManifestResource]::SizeofResource($module, $resource)
    $data = [ExhibitionManifestResource]::LoadResource($module, $resource)
    $pointer = [ExhibitionManifestResource]::LockResource($data)
    if ($size -eq 0 -or $pointer -eq [IntPtr]::Zero) { throw 'Windows应用清单无法读取' }
    $bytes = [byte[]]::new($size)
    [Runtime.InteropServices.Marshal]::Copy($pointer, $bytes, 0, $size)
    [xml]$xml = [Text.Encoding]::UTF8.GetString($bytes).Trim([char]0)
    $execution = $xml.SelectSingleNode("//*[local-name()='requestedExecutionLevel']")
    if ($null -eq $execution -or $execution.level -ne 'requireAdministrator' -or $execution.uiAccess -ne 'false') {
        throw 'Windows成品未正确要求管理员权限'
    }
    Write-Output 'Windows成品管理员权限校验通过：requireAdministrator，uiAccess=false'
} finally { [void][ExhibitionManifestResource]::FreeLibrary($module) }
