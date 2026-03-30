import type pg from "pg";
import type { Logger } from "pino";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

const SALT_ROUNDS = 12;

/** Columns returned for user queries — never includes password_hash */
const USER_COLUMNS = `
  id, username, email, display_name, role, is_active,
  force_password_change, last_login_at, login_count,
  failed_login_attempts, locked_until, password_changed_at,
  created_by, created_at, updated_at
`;

export interface User {
  id: string;
  username: string;
  email: string;
  display_name: string | null;
  role: "admin" | "operator";
  is_active: boolean;
  force_password_change: boolean;
  last_login_at: string | null;
  login_count: number;
  failed_login_attempts: number;
  locked_until: string | null;
  password_changed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface UserWithHash extends User {
  password_hash: string;
}

interface CreateUserData {
  username: string;
  email: string;
  password: string;
  displayName?: string;
  role: "admin" | "operator";
  createdBy?: string;
}

export class UserService {
  constructor(
    private pool: pg.Pool,
    private logger: Logger,
  ) {}

  // ─── Password hashing ───

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  // ─── Password strength validation ───

  validatePasswordStrength(
    password: string,
    username: string,
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (password.length < 10) {
      errors.push("Password must be at least 10 characters long");
    }
    if (!/[A-Z]/.test(password)) {
      errors.push("Password must contain at least one uppercase letter");
    }
    if (!/[a-z]/.test(password)) {
      errors.push("Password must contain at least one lowercase letter");
    }
    if (!/\d/.test(password)) {
      errors.push("Password must contain at least one digit");
    }
    if (password.toLowerCase() === username.toLowerCase()) {
      errors.push("Password cannot match the username");
    }

    return { valid: errors.length === 0, errors };
  }

  // ─── CRUD ───

  async createUser(data: CreateUserData): Promise<User> {
    const passwordHash = await this.hashPassword(data.password);

    const result = await this.pool.query<User>(
      `INSERT INTO users (username, email, password_hash, display_name, role, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${USER_COLUMNS}`,
      [
        data.username,
        data.email,
        passwordHash,
        data.displayName ?? null,
        data.role,
        data.createdBy ?? null,
      ],
    );

    this.logger.info(
      { userId: result.rows[0].id, username: data.username },
      "User created",
    );

    return result.rows[0];
  }

  async findByUsername(username: string): Promise<User | null> {
    const result = await this.pool.query<User>(
      `SELECT ${USER_COLUMNS} FROM users WHERE username = $1`,
      [username],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Find user by username including password_hash.
   * Only use for authentication — never expose the hash externally.
   */
  async findByUsernameWithHash(
    username: string,
  ): Promise<UserWithHash | null> {
    const result = await this.pool.query<UserWithHash>(
      `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE username = $1`,
      [username],
    );
    return result.rows[0] ?? null;
  }

  async findById(id: string): Promise<User | null> {
    const result = await this.pool.query<User>(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async listUsers(): Promise<User[]> {
    const result = await this.pool.query<User>(
      `SELECT ${USER_COLUMNS} FROM users ORDER BY created_at ASC`,
    );
    return result.rows;
  }

  // ─── Default admin seeding ───

  async ensureDefaultAdmin(): Promise<void> {
    const userCount = await this.pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM users",
    );

    if (parseInt(userCount.rows[0].count, 10) > 0) {
      return; // Users already exist, skip
    }

    const password = crypto.randomBytes(8).toString("hex");
    await this.createUser({
      username: "admin",
      email: "admin@localhost",
      password,
      displayName: "Administrator",
      role: "admin",
    });

    // Set force_password_change on the newly created admin
    await this.pool.query(
      "UPDATE users SET force_password_change = true WHERE username = 'admin'",
    );

    console.log("============================================");
    console.log("  DEFAULT ADMIN CREDENTIALS");
    console.log("  Username: admin");
    console.log(`  Password: ${password}`);
    console.log("  Change this password on first login.");
    console.log("============================================");
  }
}
