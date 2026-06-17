import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

// Augment the Auth.js session with our application fields.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      timezone?: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    role?: Role;
    timezone?: string | null;
  }
}
