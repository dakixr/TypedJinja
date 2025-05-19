from typedjinja.parser import parse_types_block


def test_parse_types_block_basic():
    template = """{# @types
import datetime
user: str
age: int
#}"""
    imports, annotations, malformed = parse_types_block(template)
    assert imports == ["import datetime"]
    assert annotations == {"user": "str", "age": "int"}
    assert malformed == []


def test_parse_types_block_with_docstring():
    template = (
        "{# @types\n"
        "from foo import Bar\n"
        '"""This is the user name"""\n'
        "user: str\n"
        '"""User\'s age"""\n'
        "age: int\n"
        "#}"
    )
    imports, annotations, malformed = parse_types_block(template)
    assert imports == ["from foo import Bar"]
    assert annotations == {
        "user": "str  # This is the user name",
        "age": "int  # User's age",
    }
    assert malformed == []


def test_parse_types_block_with_comments_and_whitespace():
    template = """{# @types
# This is a comment
import os

user: str
   # Another comment
age: int

#}"""
    imports, annotations, malformed = parse_types_block(template)
    assert imports == ["import os"]
    assert annotations == {"user": "str", "age": "int"}
    assert malformed == []


def test_parse_types_block_malformed_lines():
    template = """{# @types
import sys
user str  # missing colon
foo: bar:baz  # valid, type contains colon
badline
#}"""
    imports, annotations, malformed = parse_types_block(template)
    assert imports == ["import sys"]
    assert annotations == {}
    assert "user str  # missing colon" in malformed
    assert "badline" in malformed
