// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { Button, Input, Loader, Text, Banner } from "@cloudflare/kumo";
import api from "~/services/api";

export function meta() {
	return [{ title: "Login — Agentic Inbox" }];
}

export default function LoginRoute() {
	const navigate = useNavigate();
	const [isLoading, setIsLoading] = useState(true);
	const [setupRequired, setSetupRequired] = useState(false);
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [error, setError] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);

	useEffect(() => {
		api.getAuthMe()
			.then((res) => {
				if (res.authenticated) {
					navigate("/");
				} else {
					setSetupRequired(res.setupRequired);
				}
			})
			.catch((err) => {
				console.error("Failed to load auth state:", err);
				setError("Failed to verify authentication state with backend.");
			})
			.finally(() => {
				setIsLoading(false);
			});
	}, [navigate]);

	const handleLogin = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		setIsSubmitting(true);

		try {
			const res = await api.login(password);
			if (res.success) {
				window.location.href = "/";
			} else {
				setError("Invalid credentials.");
			}
		} catch (err: unknown) {
			const errMsg = err instanceof Error ? err.message : "Failed to log in.";
			setError(errMsg);
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleSetup = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");

		if (password.length < 8) {
			setError("Password must be at least 8 characters long.");
			return;
		}

		if (password !== confirmPassword) {
			setError("Passwords do not match.");
			return;
		}

		setIsSubmitting(true);

		try {
			const res = await api.setupAdmin(password);
			if (res.success) {
				window.location.href = "/";
			} else {
				setError("Failed to create admin password.");
			}
		} catch (err: unknown) {
			const errMsg = err instanceof Error ? err.message : "Failed to create admin account.";
			setError(errMsg);
		} finally {
			setIsSubmitting(false);
		}
	};

	if (isLoading) {
		return (
			<div className="flex flex-col items-center justify-center min-h-screen bg-kumo-recessed text-kumo-default gap-3">
				<Loader size="lg" />
				<p className="text-sm text-kumo-inactive">
					Verifying session security...
				</p>
			</div>
		);
	}

	return (
		<div className="flex items-center justify-center min-h-screen bg-kumo-recessed p-4">
			<div className="w-full max-w-md bg-kumo-surface border border-kumo-default rounded-lg shadow-lg p-6 space-y-6">
				<div className="space-y-2 text-center">
					<h1 className="text-2xl font-bold tracking-tight text-kumo-default">
						Agentic Inbox
					</h1>
					<p className="text-sm text-kumo-inactive">
						{setupRequired
							? "Set your master admin password to initialize the inbox."
							: "Enter your admin password to access your secure inbox."}
					</p>
				</div>

				{error && <Banner variant="error" text={error} />}

				{setupRequired ? (
					<form onSubmit={handleSetup} className="space-y-4">
						<Input
							label="Master Password"
							type="password"
							placeholder="Minimum 8 characters"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							required
							size="sm"
						/>
						<Input
							label="Confirm Password"
							type="password"
							placeholder="Confirm password"
							value={confirmPassword}
							onChange={(e) => setConfirmPassword(e.target.value)}
							required
							size="sm"
						/>
						<Button
							variant="primary"
							type="submit"
							className="w-full mt-4"
							disabled={isSubmitting}
						>
							{isSubmitting ? "Initializing..." : "Create Admin Password"}
						</Button>
					</form>
				) : (
					<form onSubmit={handleLogin} className="space-y-4">
						<Input
							label="Admin Password"
							type="password"
							placeholder="Enter password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							required
							size="sm"
						/>
						<Button
							variant="primary"
							type="submit"
							className="w-full mt-4"
							disabled={isSubmitting}
						>
							{isSubmitting ? "Signing in..." : "Sign In"}
						</Button>
					</form>
				)}
			</div>
		</div>
	);
}
