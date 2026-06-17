// Package tracking: sqlite driver registration.
//
// modernc.org/sqlite registers itself as the "sqlite" database/sql
// driver via its package init() function. The blank import below
// makes the driver available to sql.Open("sqlite", ...).
//
// Keeping this in a dedicated file makes the dependency obvious and
// isolates the side-effecting import to a single place.
package tracking

import (
	_ "modernc.org/sqlite"
)
