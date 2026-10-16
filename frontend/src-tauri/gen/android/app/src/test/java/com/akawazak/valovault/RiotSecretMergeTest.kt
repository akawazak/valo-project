package com.akawazak.valovault

import org.junit.Assert.assertEquals
import org.junit.Test

class RiotSecretMergeTest {
  @Test
  fun tokenRefreshPreservesOmittedCookie() {
    val stored = mapOf(
      "accessToken" to "old-access",
      "entitlementsToken" to "old-entitlements",
      "ssid" to "ssid=existing-cookie",
    )
    val updates = mapOf(
      "accessToken" to "new-access",
      "entitlementsToken" to "new-entitlements",
    )
    val merged = stored.mapValues { (field, previous) -> mergeRiotSecretValue(previous, updates[field]) }

    assertEquals("new-access", merged["accessToken"])
    assertEquals("new-entitlements", merged["entitlementsToken"])
    assertEquals("ssid=existing-cookie", merged["ssid"])
  }

  @Test
  fun cookieCapturePreservesTokensAndEmptyUpdates() {
    assertEquals("existing-access", mergeRiotSecretValue("existing-access", null))
    assertEquals("existing-entitlements", mergeRiotSecretValue("existing-entitlements", ""))
    assertEquals("ssid=new-cookie", mergeRiotSecretValue("ssid=old-cookie", "ssid=new-cookie"))
    assertEquals("", mergeRiotSecretValue(null, null))
  }
}
