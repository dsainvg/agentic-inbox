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
			<div className="flex flex-col items-center justify-center min-h-screen bg-[#090909] gap-3">
				<Loader size="lg" />
				<p className="text-[13px] text-white/30">
					Verifying session security...
				</p>
			</div>
		);
	}

	return (
		<div className="flex items-center justify-center min-h-screen bg-[#090909] p-4">
			<div className="w-full max-w-sm bg-[#111111] border border-white/[0.08] rounded-xl shadow-2xl p-8 space-y-7">
				<div className="text-center space-y-2">
					<h1 className="text-[22px] font-bold text-white/95 tracking-tight">
						Agentic Inbox
					</h1>
					<p className="text-[13px] text-white/40">
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
