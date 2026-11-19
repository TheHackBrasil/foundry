// Local declaration for the adjacent CSS module.
// Keeps `import styles from './Domino.module.css'` typed even if the
// ambient astro/client types are not loaded by astro check.
declare const classes: { readonly [key: string]: string };
export default classes;
