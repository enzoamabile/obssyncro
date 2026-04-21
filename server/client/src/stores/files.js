import { writable, derived } from 'svelte/store';

export const files = writable([]);
export const currentFile = writable(null);
export const selectedPath = writable(null);

export const currentContent = derived(currentFile, ($currentFile) => {
  return $currentFile?.content || '';
});

export function updateFileContent(path, content) {
  files.update($files => {
    const file = $files.find(f => f.path === path);
    if (file) {
      file.content = content;
    }
    return $files;
  });
}

export function addFile(file) {
  files.update($files => {
    const idx = $files.findIndex(f => f.path === file.path);
    if (idx >= 0) {
      $files[idx] = file;
    } else {
      $files.push(file);
    }
    return $files;
  });
}

export function removeFile(path) {
  files.update($files => $files.filter(f => f.path !== path));
}
