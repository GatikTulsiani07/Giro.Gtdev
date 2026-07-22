const url = process.env.GIRO_POSTGRES_TEST_URL?.trim();

if (!url) {
  process.stderr.write(
    "validate:production requires GIRO_POSTGRES_TEST_URL; PostgreSQL validation must not be skipped.\n",
  );
  process.exit(1);
}

process.stdout.write("Required PostgreSQL production validation is configured.\n");
