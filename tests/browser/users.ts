import path from "node:path";

/** A dev user of Dex (deploy/dex/config.yaml.tpl); every password is "password". */
export interface User {
  email: string;
  password: string;
  /** Where auth.setup.ts saves the signed-in browser state. */
  storageState: string;
}

const user = (name: string): User => ({
  email: `${name}@example.com`,
  password: "password",
  storageState: path.join(import.meta.dirname, ".auth", `${name}.json`),
});

export const users = { alice: user("alice"), bob: user("bob") };
