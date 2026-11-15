package main

import (
	"slices"
	"testing"
)

func TestBootstrapAdminsComeFromTheEnvironment(t *testing.T) {
	cfg, err := loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.BootstrapAdmins) != 0 || cfg.GRPCPort != 9006 || cfg.MetricsPort != 9106 {
		t.Errorf("defaults = %+v", cfg)
	}
	t.Setenv("KNOWCEL_IAM_BOOTSTRAP_ADMINS", "alice@example.com,sub-2")
	cfg, err = loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(cfg.BootstrapAdmins, []string{"alice@example.com", "sub-2"}) {
		t.Errorf("admins = %v", cfg.BootstrapAdmins)
	}
}

func TestInvalidDatabaseURLIsRejected(t *testing.T) {
	t.Setenv("KNOWCEL_DATABASE_URL", "mysql://x")
	if _, err := loadConfig(); err == nil {
		t.Error("want an error for a non-postgres URL")
	}
}
