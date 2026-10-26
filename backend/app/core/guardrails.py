import re
from typing import Tuple

class EquiVaultGuardrails:
    # Forbidden phrases that indicate "financial advice" instead of "education"
    FORBIDDEN_PHRASES = [
        "i guarantee", "promised return", "will make money", 
        "invest all your money", "risk-free", "certain profit"
    ]
    
    # Keywords to ensure the conversation stays on topic
    FINANCIAL_KEYWORDS = [
        "stocks?", "shares?", "prices?", "tickers?", "quotes?", "equities?",
        "investment", "investing", "strateg(?:y|ies)", "dividends?", "portfolios?",
        "trading", "financial",
    ]

    @staticmethod
    def check_input(query: str) -> Tuple[bool, str]:
        """Check whether a query is about stocks or related investing education."""
        if not any(
            re.search(rf"\b{keyword}\b", query.lower())
            for keyword in EquiVaultGuardrails.FINANCIAL_KEYWORDS
        ):
            return False, (
                "I'm EquiVault AI, focused on stock-market education and stock-related "
                "information. I can't help with unrelated topics. Ask about stocks, "
                "share prices, market concepts, or investing strategies."
            )
        return True, ""

    @staticmethod
    def check_output(answer: str) -> Tuple[bool, str]:
        """Check if the AI is giving prohibited financial guarantees."""
        for phrase in EquiVaultGuardrails.FORBIDDEN_PHRASES:
            if phrase in answer.lower():
                return False, "Guardrail Triggered: The AI attempted to give a financial guarantee. Please consult a certified professional for specific advice."
        return True, ""
