/*
 * Copyright 2025-2026 @NightMean (https://github.com/NightMean)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.ollitert.llm.server

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies product flavor build configuration is wired up correctly.
 * These tests validate that BuildConfig fields, application ID suffixes,
 * and version name suffixes are set as expected for the active flavor.
 */
class BuildConfigFlavorTest {

  @Test
  fun channelFieldIsPresent() {
    // BuildConfig.CHANNEL must be one of the defined flavors
    val validChannels = setOf("dev", "beta", "stable", "hermes")
    assertTrue(
      "BuildConfig.CHANNEL ('${BuildConfig.CHANNEL}') must be one of $validChannels",
      BuildConfig.CHANNEL in validChannels,
    )
  }

  @Test
  fun applicationIdMatchesFlavor() {
    // applicationId should have the correct suffix for the active flavor
    when (BuildConfig.CHANNEL) {
      "dev" -> assertTrue(
        "Dev applicationId should end with .dev",
        BuildConfig.APPLICATION_ID.endsWith(".dev"),
      )
      "beta" -> assertTrue(
        "Beta applicationId should end with .beta",
        BuildConfig.APPLICATION_ID.endsWith(".beta"),
      )
      "stable" -> assertEquals(
        "Prod applicationId should have no suffix",
        "com.ollitert.llm.server",
        BuildConfig.APPLICATION_ID,
      )
      "hermes" -> assertTrue(
        "HERMES applicationId should end with .hermes",
        BuildConfig.APPLICATION_ID.endsWith(".hermes"),
      )
    }
  }

  @Test
  fun hermesFlavorIsLoopbackOnlyAndHasNoBackgroundNetwork() {
    if (BuildConfig.CHANNEL == "hermes") {
      assertTrue("HERMES must enforce loopback only", BuildConfig.HERMES_LOOPBACK_ONLY)
      assertTrue(
        "HERMES must disable background network workers",
        BuildConfig.HERMES_DISABLE_BACKGROUND_NETWORK,
      )
      assertEquals("HERMES update channel must be disabled", "disabled", BuildConfig.UPDATE_CHANNEL)
    }
  }

  @Test
  fun versionNameMatchesFlavorPolicy() {
    when (BuildConfig.CHANNEL) {
      "dev" -> assertTrue(
        "Dev versionName should contain -dev suffix",
        BuildConfig.VERSION_NAME.endsWith("-dev"),
      )
      "beta" -> assertTrue(
        "Beta versionName should contain -beta suffix",
        BuildConfig.VERSION_NAME.endsWith("-beta"),
      )
      "stable" -> assertTrue(
        "Prod versionName should not contain channel suffix",
        !BuildConfig.VERSION_NAME.contains("-dev") && !BuildConfig.VERSION_NAME.contains("-beta"),
      )
      "hermes" -> assertTrue(
        "HERMES versionName must be a plain semantic version, aligned with the model catalog",
        BuildConfig.VERSION_NAME.matches(Regex("""\d+\.\d+\.\d+""")),
      )
    }
  }

}
