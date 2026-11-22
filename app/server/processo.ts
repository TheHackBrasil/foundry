import { pathToFileURL } from 'node:url';

// pathToFileURL cobre POSIX, Windows e caminho com espaço; montar file:/// na
// mão gerava file://// no Linux e o servidor nunca subia.
export function ehProcessoPrincipal(metaUrl: string, argv1: string | undefined): boolean {
  return argv1 !== undefined && metaUrl === pathToFileURL(argv1).href;
}
