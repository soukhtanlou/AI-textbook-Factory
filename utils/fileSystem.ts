
/**
 * Saves a Blob or File to the selected directory handle with the given filename.
 */
export async function saveFileToFolder(dirHandle: FileSystemDirectoryHandle, filename: string, blob: Blob | File) {
  // create: true ensures the file is created if it doesn't exist
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

/**
 * Retrieves a file from the directory handle and creates an Object URL for preview.
 */
export async function getFileUrl(dirHandle: FileSystemDirectoryHandle, filename: string): Promise<string> {
  const fileHandle = await dirHandle.getFileHandle(filename);
  const file = await fileHandle.getFile();
  return URL.createObjectURL(file);
}

/**
 * Retrieves a File object directly (used for Zip export).
 */
export async function getFileFromHandle(dirHandle: FileSystemDirectoryHandle, filename: string): Promise<File> {
    const fileHandle = await dirHandle.getFileHandle(filename);
    return await fileHandle.getFile();
}

/**
 * Alias for getFileFromHandle to support different import naming conventions if needed
 */
export const readFileFromFolder = getFileFromHandle;
