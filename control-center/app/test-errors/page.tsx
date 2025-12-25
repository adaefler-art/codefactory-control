/**
 * Test page to demonstrate improved error handling
 * This page allows testing different error scenarios
 */

"use client";

import { useState } from "react";
import { safeFetch, formatErrorMessage, isApiError } from "@/lib/api/safe-fetch";

export default function ErrorTestPage() {
  const [result, setResult] = useState<string>("");
  const [errorDetails, setErrorDetails] = useState<string>("");

  const testScenario = async (scenario: string) => {
    setResult("");
    setErrorDetails("");

    try {
      let response: Response;
      
      switch (scenario) {
        case "404":
          // Test 404 error
          response = await fetch("/api/nonexistent-endpoint", { credentials: "include" });
          await safeFetch(response);
          setResult("Success (unexpected)");
          break;
          
        case "500":
          // Test 500 error - we can trigger this by sending invalid data
          response = await fetch("/api/issues", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ invalid: "data" }),
          });
          await safeFetch(response);
          setResult("Success (unexpected)");
          break;
          
        case "network":
          // Simulate network error by calling non-existent domain (will fail in browser)
          response = await fetch("https://nonexistent-domain-12345.invalid");
          await safeFetch(response);
          setResult("Success (unexpected)");
          break;
          
        case "empty-response":
          // Test empty/malformed JSON response
          // This would normally cause "Unexpected JSON end" error
          response = new Response("", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
          await safeFetch(response);
          setResult("Success (unexpected)");
          break;
          
        case "success":
          // Test successful response
          response = await fetch("/api/health", { credentials: "include" });
          const data = await safeFetch(response);
          setResult(`Success: ${JSON.stringify(data, null, 2)}`);
          break;
          
        default:
          setResult("Unknown scenario");
      }
    } catch (error) {
      console.error("Test error:", error);
      
      // Show formatted error message (what users see)
      setResult(`Error: ${formatErrorMessage(error)}`);
      
      // Show detailed error information
      if (isApiError(error)) {
        setErrorDetails(
          `API Error Details:\n` +
          `Status: ${error.status}\n` +
          `Message: ${error.message}\n` +
          `Details: ${JSON.stringify(error.details, null, 2)}`
        );
      } else if (error instanceof Error) {
        setErrorDetails(
          `Error Details:\n` +
          `Name: ${error.name}\n` +
          `Message: ${error.message}\n` +
          `Stack: ${error.stack}`
        );
      } else {
        setErrorDetails(`Unknown error type: ${JSON.stringify(error)}`);
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6 text-purple-400">
          API Error Handling Test Page
        </h1>
        
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Test Scenarios</h2>
          <p className="text-gray-400 mb-4">
            Click a button to test different error handling scenarios.
            Before the fix, these would show "Unexpected JSON end" errors.
            After the fix, they show meaningful error messages.
          </p>
          
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <button
              onClick={() => testScenario("success")}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-white font-medium transition-colors"
            >
              ✓ Success Case
            </button>
            
            <button
              onClick={() => testScenario("404")}
              className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 rounded text-white font-medium transition-colors"
            >
              404 Not Found
            </button>
            
            <button
              onClick={() => testScenario("500")}
              className="px-4 py-2 bg-orange-600 hover:bg-orange-700 rounded text-white font-medium transition-colors"
            >
              500 Server Error
            </button>
            
            <button
              onClick={() => testScenario("network")}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-white font-medium transition-colors"
            >
              Network Error
            </button>
            
            <button
              onClick={() => testScenario("empty-response")}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded text-white font-medium transition-colors"
            >
              Empty Response
            </button>
          </div>
        </div>
        
        {result && (
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-6">
            <h3 className="text-lg font-semibold mb-2 text-gray-200">Result</h3>
            <pre className="bg-gray-800 p-4 rounded text-sm overflow-x-auto text-gray-300">
              {result}
            </pre>
          </div>
        )}
        
        {errorDetails && (
          <div className="bg-gray-900 border border-red-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-2 text-red-400">Error Details (Debug)</h3>
            <pre className="bg-gray-800 p-4 rounded text-sm overflow-x-auto text-gray-300">
              {errorDetails}
            </pre>
          </div>
        )}
        
        <div className="mt-8 p-4 bg-blue-900/20 border border-blue-800 rounded-lg">
          <h3 className="text-lg font-semibold mb-2 text-blue-400">What Changed?</h3>
          <ul className="list-disc list-inside text-gray-300 space-y-2">
            <li>
              <strong>Before:</strong> Calling <code className="bg-gray-800 px-2 py-1 rounded">response.json()</code> on 
              error responses caused "Unexpected JSON end" errors
            </li>
            <li>
              <strong>After:</strong> The <code className="bg-gray-800 px-2 py-1 rounded">safeFetch()</code> utility 
              checks response status first and handles JSON parsing errors gracefully
            </li>
            <li>
              Error messages are now clear and actionable, showing HTTP status codes and server error details
            </li>
            <li>
              Non-JSON error responses (like HTML error pages) are handled properly
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
