from pydantic import BaseModel, Field
from typing import List, Optional


class SourceDocument(BaseModel):
    title: str
    url: str
    content: str
    publisher: Optional[str] = None
    published_at: Optional[str] = None


class StockHistoryPoint(BaseModel):
    date: str
    close: float
    high: Optional[float] = None
    low: Optional[float] = None
    volume: Optional[int] = None


class StockData(BaseModel):
    symbol: str
    name: str
    exchange: str = ""
    currency: str = ""
    current_price: float
    change_percent: Optional[float] = None
    fifty_two_week_low: Optional[float] = None
    fifty_two_week_high: Optional[float] = None
    as_of: Optional[str] = None
    history: List[StockHistoryPoint]


class ChatRequest(BaseModel):
    message: str
    user_id: str
    role: Optional[str] = None
    chat_history: Optional[List[dict]] = []
    search_web: bool = False

class ChatResponse(BaseModel):
    answer: str
    sources: List[SourceDocument] = []
    search_used: bool = False
    needs_web_search: bool = False
    stock_data: Optional[StockData] = None
    market_data_notice: Optional[str] = None
    status: str = "success" # success, pending_human, error
