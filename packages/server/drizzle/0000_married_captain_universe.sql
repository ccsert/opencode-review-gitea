CREATE TABLE IF NOT EXISTS "ai_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"base_url" text,
	"api_key" text,
	"models" jsonb DEFAULT '[]'::jsonb,
	"default_model" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"base_url" text NOT NULL,
	"name" text NOT NULL,
	"access_token" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "repositories" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"platform_credential_id" text,
	"provider" text NOT NULL,
	"provider_repo_id" text,
	"url" text NOT NULL,
	"name" text NOT NULL,
	"webhook_secret" text,
	"webhook_id" integer,
	"webhook_status" text DEFAULT 'pending',
	"webhook_error" text,
	"access_token" text,
	"template_id" text,
	"config" jsonb DEFAULT '{}'::jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_review_at" timestamp with time zone,
	"review_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"description" text,
	"system_prompt" text NOT NULL,
	"categories" jsonb DEFAULT '["BUG","SECURITY","PERFORMANCE","STYLE"]'::jsonb,
	"severities" jsonb DEFAULT '["CRITICAL","HIGH","MEDIUM","LOW"]'::jsonb,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"repository_id" text NOT NULL,
	"pr_number" integer NOT NULL,
	"pr_title" text,
	"pr_author" text,
	"pr_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"summary" text,
	"decision" text,
	"comments_count" integer DEFAULT 0 NOT NULL,
	"model" text,
	"tokens_used" integer,
	"duration_ms" integer,
	"error" text,
	"triggered_by" text,
	"webhook_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"repository_id" text,
	"event_type" text NOT NULL,
	"delivery_id" text,
	"payload" jsonb,
	"headers" jsonb,
	"processed" boolean DEFAULT false NOT NULL,
	"review_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "platform_credentials" ADD CONSTRAINT "platform_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repositories" ADD CONSTRAINT "repositories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repositories" ADD CONSTRAINT "repositories_platform_credential_id_platform_credentials_id_fk" FOREIGN KEY ("platform_credential_id") REFERENCES "public"."platform_credentials"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repositories" ADD CONSTRAINT "repositories_template_id_review_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."review_templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_templates" ADD CONSTRAINT "review_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reviews" ADD CONSTRAINT "reviews_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "webhook_logs" ADD CONSTRAINT "webhook_logs_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_providers_user" ON "ai_providers" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_providers_provider" ON "ai_providers" ("provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_providers_default" ON "ai_providers" ("user_id","is_default");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_platform_creds_user" ON "platform_credentials" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_platform_creds_provider" ON "platform_credentials" ("provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_repos_user" ON "repositories" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_repos_provider" ON "repositories" ("provider","provider_repo_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_repos_name" ON "repositories" ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_reviews_repo" ON "reviews" ("repository_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_reviews_status" ON "reviews" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_webhook_logs_repo" ON "webhook_logs" ("repository_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_webhook_logs_delivery" ON "webhook_logs" ("delivery_id");