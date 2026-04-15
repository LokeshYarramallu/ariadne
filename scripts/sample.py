"""Sample Python module for parser testing."""

import os
import sys
from pathlib import Path, PurePath
from typing import Optional, List

CONSTANT = 42


def standalone(text: str) -> str:
    """A top-level function with a docstring."""
    result = text.strip()
    return result


def calls_standalone(value: str) -> Optional[str]:
    if not value:
        return None
    cleaned = standalone(value)
    return cleaned.upper()


@staticmethod
def decorated_func(x: int, y: int = 0) -> int:
    """A decorated function."""
    return x + y


class Animal:
    """Base class for animals."""

    def __init__(self, name: str, species: str):
        self.name = name
        self.species = species

    def speak(self) -> str:
        raise NotImplementedError

    def describe(self) -> str:
        """Return a human-readable description."""
        return f"{self.name} is a {self.species}"


class Dog(Animal):
    """A Dog that can bark."""

    def __init__(self, name: str):
        super().__init__(name, "dog")

    def speak(self) -> str:
        return self.describe() + " and says woof"

    def fetch(self, item: str) -> str:
        path = os.path.join("/tmp", item)
        return standalone(path)
